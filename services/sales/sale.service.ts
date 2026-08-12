import { computeBusinessDate, widenToBusinessDateRangeStart } from "@/lib/business-date";
import type { PaymentMethod, Prisma, Sale } from "@/lib/generated/prisma/client";
import type { SaleCategory, SaleSource } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
import type { DateRange } from "@/services/analytics/date-range";
import { formatSaleNumber } from "@/services/sales/sale-reference";
import { settingsService } from "@/services/settings/settings.service";

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

interface AuditLogEntry {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

export interface CreateSaleInput {
  category: SaleCategory;
  source?: SaleSource;
  amountCents: number;
  paymentMethodId: string;
  employeeId: string;
  shiftId: string;
  playerId?: string | null;
  bookingId?: string;
  membershipId?: string;
  equipmentRentalId?: string;
  lockerRentalId?: string;
  tournamentRegistrationId?: string;
  productId?: string;
  playerTabId?: string;
  openPlayNightRegistrationId?: string;
  bookingTabId?: string;
  // First real writer (2026-08-04) — see coach-session-fee-sale.ts's own
  // comment for why a coach session's fee is its own Sale (category
  // COACHING), separate from the court booking's own BOOKING Sale, not
  // folded into one combined amount.
  coachSessionId?: string;
  description?: string;
  notes?: string;
  // Backfill-only escape hatch — every live revenue path leaves this
  // unset and gets the real current moment, exactly as before. A
  // backdated backfill (see coach-session-fee-sale.ts) sets it to when
  // the money actually changed hands historically, so the row's own
  // saleNumber sequence AND createdAt both land on that real day — not
  // "today," which would otherwise silently inflate the Today's Revenue
  // panel and shift cash reconciliation by the backfilled amount
  // (reported live, 2026-08-04: the first backfill run did exactly this).
  createdAt?: Date;
}

export interface UpsertPaymentMethodInput {
  key: string;
  label: string;
  sortOrder?: number;
}

// Reported live: "separate the regular and unli open play payments" — one
// lumped SaleCategory.OPEN_PLAY total was hiding two genuinely different
// products (see schema.prisma's own comment above Sale.
// openPlayNightRegistrationId): a flat Fri/Sat "unli" access fee
// (Sale.openPlayNightRegistrationId, pay once, play all night) versus
// per-game/per-tab "regular" billing (Sale.playerTabId — weeknight ₱35/game,
// and any incidental Fri/Sat tab charges too, since those are pay-as-you-go
// the same way). Split at the breakdown-row level, not in the schema —
// SaleCategory itself stays a single enum value; these two synthetic labels
// only exist in this summary's own output.
export type OpenPlaySummaryCategory = "OPEN_PLAY_REGULAR" | "OPEN_PLAY_UNLI";

export interface SalesSummaryCategoryBreakdown {
  category: SaleCategory | OpenPlaySummaryCategory;
  amountCents: number;
  count: number;
}

export interface SalesSummaryPaymentMethodBreakdown {
  paymentMethodId: string;
  label: string;
  amountCents: number;
  count: number;
}

export interface SalesSummaryEmployeeBreakdown {
  employeeId: string;
  employeeNumber: string;
  name: string;
  amountCents: number;
  count: number;
}

export interface SalesSummary {
  totalAmountCents: number;
  transactionCount: number;
  averageAmountCents: number;
  byCategory: SalesSummaryCategoryBreakdown[];
  byPaymentMethod: SalesSummaryPaymentMethodBreakdown[];
  byEmployee: SalesSummaryEmployeeBreakdown[];
}

export interface ShiftSalesSummary {
  totalAmountCents: number;
  transactionCount: number;
}

// The single place responsible for creating Sale rows — every revenue
// workflow (booking/membership/equipment rental/locker rental/tournament
// registration) calls createSale, never prisma.sale.create directly.
export class SaleService {
  // Called from inside each revenue workflow's own transaction (pass that
  // transaction's `tx` as `client`) so the Sale and its source row commit
  // atomically — never one without the other. `saleNumber` comes from the
  // shared atomic counter (lib/reference-counter.ts), so no retry-on-
  // collision handling is needed here — it can't collide.
  async createSale(
    input: CreateSaleInput,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<Sale> {
    const now = input.createdAt ?? new Date();
    const sequence = await nextSequence(dailyScope("SALE", now), client);
    const saleNumber = formatSaleNumber(now, sequence);
    // Owner-directed consolidation (2026-08-12): set once, here, via the
    // same computeBusinessDate every other correct part of this app
    // uses — not recomputed per query at report time. See this
    // column's own schema comment for why every category needed this,
    // not just Open Play.
    //
    // Open Play is a deliberate exception to "compute from now": the
    // Aug 7 incident this whole column generalizes was specifically
    // about a tab/registration for one night being SETTLED well after
    // that night ended (sometimes the next day, past the next
    // rollover too) — PlayerTab.date/OpenPlayNightRegistration.date
    // already holds which business night the sale is really FOR
    // (itself written by the rollover-aware write guard at check-in
    // time), which is a genuinely different question from "when was
    // this Sale row created." Every other category has no such
    // distinction — a booking/coaching/product Sale is created at the
    // moment the transaction happens, so "when created" and "which
    // business day this belongs to" are the same instant.
    let businessDate: Date;
    if (input.playerTabId) {
      const tab = await client.playerTab.findUniqueOrThrow({
        where: { id: input.playerTabId },
        select: { date: true },
      });
      businessDate = tab.date;
    } else if (input.openPlayNightRegistrationId) {
      const registration = await client.openPlayNightRegistration.findUniqueOrThrow({
        where: { id: input.openPlayNightRegistrationId },
        select: { date: true },
      });
      businessDate = registration.date;
    } else {
      const courtHours = await settingsService.getCourtHours();
      businessDate = computeBusinessDate(now, courtHours.businessDateRolloverHour);
    }

    return client.sale.create({
      data: {
        saleNumber,
        createdAt: now,
        businessDate,
        category: input.category,
        source: input.source ?? "RECEPTION",
        amountCents: input.amountCents,
        paymentMethodId: input.paymentMethodId,
        employeeId: input.employeeId,
        shiftId: input.shiftId,
        playerId: input.playerId ?? undefined,
        bookingId: input.bookingId,
        membershipId: input.membershipId,
        equipmentRentalId: input.equipmentRentalId,
        lockerRentalId: input.lockerRentalId,
        tournamentRegistrationId: input.tournamentRegistrationId,
        productId: input.productId,
        playerTabId: input.playerTabId,
        openPlayNightRegistrationId: input.openPlayNightRegistrationId,
        bookingTabId: input.bookingTabId,
        coachSessionId: input.coachSessionId,
        description: input.description,
        notes: input.notes,
      },
    });
  }

  // Callers write the Sale itself inside their own transaction (above), then
  // call this afterward on the default client, once that transaction has
  // committed — same "audit log after commit" convention every other
  // service in this app follows.
  // Real incident (2026-08-06): the public booking double-submit bug
  // produced a duplicate Sale for one real GCash payment. SaleStatus.VOID
  // has existed in the schema since Phase 4 but nothing ever set it —
  // this is the first caller. An offsetting entry, not a hard delete: the
  // row survives with every original field intact (amount, paymentMethod,
  // shift, employee, createdAt) — only `status` changes, which is exactly
  // what every reconciliation/revenue query already filters on
  // (status: "COMPLETED" — getSalesSummary, getGcashSalesForDate,
  // getCashSalesForDate, getCashSalesForShift, and every report in
  // reporting.service.ts, confirmed by reading each one directly). A VOID
  // sale drops out of all of them with no other change needed anywhere.
  // Accepts a transaction client so a caller (bookingRefundService) can
  // void the Sale and write its own records atomically. Deliberately
  // writes no audit log itself when given a transaction client — same
  // "write the row in the transaction, log the audit AFTER commit, on the
  // default client" split createSale/logSaleCreated already establish
  // (see logSaleCreated's own comment); logging here immediately would
  // commit an audit entry even if the surrounding transaction later rolls
  // back. Callers running this standalone (default client, no wrapping
  // transaction) should call logSaleVoided themselves right after.
  async voidSale(
    saleId: string,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<Sale> {
    const existing = await client.sale.findUniqueOrThrow({ where: { id: saleId } });
    if (existing.status !== "COMPLETED") {
      throw new Error(`Only a COMPLETED sale can be voided (current status: ${existing.status}).`);
    }

    return client.sale.update({
      where: { id: saleId },
      data: { status: "VOID" },
    });
  }

  // Owner request (2026-08-08): an attendant sometimes records a Cash
  // payment as GCash (or the reverse) — leaves cash short and GCash over
  // by the same amount. Investigated first (report-only) and confirmed no
  // correction path existed; the only post-creation Sale mutation was
  // voidSale, an all-or-nothing offsetting entry, not a correction. This
  // is the real fix: the underlying Sale is corrected so the variance
  // disappears legitimately, not an override that hides it.
  //
  // Follows playerTabService.writeOffTab's pattern exactly, per the
  // owner's own explicit instruction — same "no anonymous adjustments"
  // shape: a required, non-empty reason; a real employeeId (who made the
  // correction) alongside actorUserId (for the audit log); an atomic
  // claim-check update (not check-then-act) scoped to the CALLER-SUPPLIED
  // expected current paymentMethodId, so a stale UI or a double-submit
  // can't silently apply on top of a sale that already changed; and a
  // single audit log entry with oldValues/newValues, not a separate child
  // table (mirrors PlayerTab.writeOffReason/writeOffEmployeeId's "columns
  // on the row" shape, not BookingRefund's durable child row).
  //
  // Owner decision (2026-08-08, after investigation): BLOCK the
  // correction if either the FROM or TO payment method is CASH/GCASH and
  // that calendar day's reconciliation is already CONFIRMED — "a
  // confirmed day is a number someone signed off on; if a correction can
  // silently change it afterwards, the confirmation means nothing."
  // Reopening first (cashReconciliationService/gcashReconciliationService
  // .reopenBalance, already reason-required and already granted to OWNER)
  // is the deliberate extra step and the visible trail — this method does
  // NOT reopen anything on the caller's behalf.
  async correctPaymentMethod(
    saleId: string,
    fromPaymentMethodId: string,
    toPaymentMethodId: string,
    reason: string,
    employeeId: string,
    actorUserId: string,
  ): Promise<Sale> {
    if (!reason.trim()) {
      throw new Error("A reason is required to correct a sale's payment method.");
    }
    if (!employeeId) {
      throw new Error("An employee must be attributed to a payment-method correction.");
    }
    if (fromPaymentMethodId === toPaymentMethodId) {
      throw new Error("The new payment method must be different from the current one.");
    }

    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });
    if (sale.status !== "COMPLETED") {
      throw new Error(
        `Only a COMPLETED sale can have its payment method corrected (current status: ${sale.status}).`,
      );
    }

    const [fromMethod, toMethod] = await Promise.all([
      prisma.paymentMethod.findUniqueOrThrow({ where: { id: fromPaymentMethodId } }),
      prisma.paymentMethod.findUniqueOrThrow({ where: { id: toPaymentMethodId } }),
    ]);

    await this.assertReconciliationDayNotConfirmed(sale.createdAt, fromMethod.key);
    await this.assertReconciliationDayNotConfirmed(sale.createdAt, toMethod.key);

    const claim = await prisma.sale.updateMany({
      where: { id: saleId, status: "COMPLETED", paymentMethodId: fromPaymentMethodId },
      data: {
        paymentMethodId: toPaymentMethodId,
        paymentMethodCorrectedAt: new Date(),
        paymentMethodCorrectionReason: reason,
        paymentMethodCorrectedByEmployeeId: employeeId,
      },
    });
    if (claim.count === 0) {
      throw new Error(
        "This sale's payment method has already changed since you loaded it — refresh and try again.",
      );
    }

    const updated = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });

    await this.writeAuditLog({
      actorUserId,
      action: "sale.payment_method_corrected",
      entityType: "Sale",
      entityId: saleId,
      oldValues: { paymentMethodId: fromPaymentMethodId },
      newValues: { paymentMethodId: toPaymentMethodId, reason, employeeId },
    });

    return updated;
  }

  // Owner request (2026-08-10): "the staff encoded wrong product and
  // wants it to void" — voidSale (above) is the internal, unattributed
  // offsetting-entry primitive bookingRefundService uses; this is the
  // real owner-facing correction path on top of it, following
  // correctPaymentMethod's own pattern exactly: a required, non-empty
  // reason; a real employeeId (who reported the wrong encoding)
  // alongside actorUserId (who's voiding it); an atomic claim-check
  // update scoped to status COMPLETED, so a stale UI or a double-submit
  // can't double-void; the same CASH/GCASH confirmed-day block as the
  // payment-method correction, since voiding also changes a
  // reconciled day's total. Columns on the row (voidedAt/voidReason/
  // voidedByEmployeeId) + one audit log entry, no separate child table.
  async voidSaleAsCorrection(
    saleId: string,
    reason: string,
    employeeId: string,
    actorUserId: string,
  ): Promise<Sale> {
    if (!reason.trim()) {
      throw new Error("A reason is required to void a sale.");
    }
    if (!employeeId) {
      throw new Error("An employee must be attributed to a void.");
    }

    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });
    if (sale.status !== "COMPLETED") {
      throw new Error(`Only a COMPLETED sale can be voided (current status: ${sale.status}).`);
    }

    const paymentMethod = await prisma.paymentMethod.findUniqueOrThrow({
      where: { id: sale.paymentMethodId },
    });
    await this.assertReconciliationDayNotConfirmed(sale.createdAt, paymentMethod.key);

    const claim = await prisma.sale.updateMany({
      where: { id: saleId, status: "COMPLETED" },
      data: {
        status: "VOID",
        voidedAt: new Date(),
        voidReason: reason,
        voidedByEmployeeId: employeeId,
      },
    });
    if (claim.count === 0) {
      throw new Error("This sale has already changed since you loaded it — refresh and try again.");
    }

    const updated = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });

    await this.writeAuditLog({
      actorUserId,
      action: "sale.voided_as_correction",
      entityType: "Sale",
      entityId: saleId,
      oldValues: { status: "COMPLETED" },
      newValues: { status: "VOID", reason, employeeId },
    });

    return updated;
  }

  // Cash/GCash daily reconciliation is keyed by calendar date
  // (CashDailyBalance/GcashDailyBalance.date, midnight-normalized) — a
  // payment method with no daily-balance concept (Bank Transfer, Card,
  // Pay at Venue) has nothing to check here and is always allowed through.
  private async assertReconciliationDayNotConfirmed(
    saleCreatedAt: Date,
    paymentMethodKey: string,
  ): Promise<void> {
    if (paymentMethodKey !== "CASH" && paymentMethodKey !== "GCASH") {
      return;
    }
    const date = new Date(
      saleCreatedAt.getFullYear(),
      saleCreatedAt.getMonth(),
      saleCreatedAt.getDate(),
    );
    if (paymentMethodKey === "CASH") {
      const balance = await prisma.cashDailyBalance.findUnique({ where: { date } });
      if (balance?.status === "CONFIRMED") {
        throw new Error(
          `The cash reconciliation for ${date.toDateString()} is already confirmed — reopen it first before correcting this sale.`,
        );
      }
    } else {
      const balance = await prisma.gcashDailyBalance.findUnique({ where: { date } });
      if (balance?.status === "CONFIRMED") {
        throw new Error(
          `The GCash reconciliation for ${date.toDateString()} is already confirmed — reopen it first before correcting this sale.`,
        );
      }
    }
  }

  // Companion to logSaleCreated, same "after commit, default client"
  // convention.
  async logSaleVoided(sale: Sale, actorUserId: string): Promise<void> {
    await this.writeAuditLog({
      actorUserId,
      action: "sale.voided",
      entityType: "Sale",
      entityId: sale.id,
      newValues: sale,
    });
  }

  async logSaleCreated(sale: Sale, actorUserId: string): Promise<void> {
    await this.writeAuditLog({
      actorUserId,
      action: "sale.created",
      entityType: "Sale",
      entityId: sale.id,
      newValues: sale,
    });
  }

  async listSalesForPlayer(playerId: string): Promise<Sale[]> {
    return prisma.sale.findMany({ where: { playerId }, orderBy: { createdAt: "desc" } });
  }

  // Owner request (2026-08-10): "the staff encoded wrong product and
  // wants it to void" — powers the Shop page's own "Recent sales" list,
  // the surface staff/owner actually see the wrong-product sale from.
  // COMPLETED and VOID both included (a voided row still needs to show,
  // with its badge, so it's clear it was handled) — only excludes
  // nothing, since this is a short recent-activity list, not a revenue
  // total.
  async listRecentProductSales(limit = 20) {
    return prisma.sale.findMany({
      where: { category: "PRODUCT" },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        product: { select: { name: true } },
        employee: { select: { firstName: true, lastName: true } },
        paymentMethod: { select: { label: true } },
        voidedByEmployee: { select: { firstName: true, lastName: true } },
      },
    });
  }

  // Powers the Operations Workspace's Today's Revenue panel and the
  // Sale-backed report types — one grouped-query pass, no per-row loop.
  // VOID sales are excluded (COMPLETED only) since a voided sale isn't
  // revenue.
  //
  // byCategory's row order below is explicitly sorted by this list, not
  // left to Prisma's groupBy — reported live (2026-08-04): with no
  // orderBy, Postgres returned Coaching before Booking regardless of
  // which had the larger amount, an unstable/arbitrary order that read
  // as "sorted by size" but wasn't. Fixed categories go first in a
  // sensible reading order; anything not listed here (a future category)
  // sorts after everything named, alphabetically among itself.
  static readonly CATEGORY_DISPLAY_ORDER: readonly string[] = [
    "BOOKING",
    "COACHING",
    "MEMBERSHIP",
    "EQUIPMENT_RENTAL",
    "LOCKER_RENTAL",
    "TOURNAMENT_REGISTRATION",
    "OPEN_PLAY_REGULAR",
    "OPEN_PLAY_UNLI",
    "PRODUCT",
    "OTHER",
  ];

  // Owner-directed consolidation (2026-08-12): "getSalesSummary applies
  // business-date logic to EVERY category, not just Open Play. The
  // split you found is the bug; generalize the fix that was made
  // narrowly on Aug 7." Sale.businessDate (set once, at creation — see
  // that column's own schema comment) replaces the old OPEN_PLAY-only
  // OR split entirely: every category now filters on the same column,
  // no join needed. rolloverHour normalizes range.from/range.to into
  // business-date terms before filtering — the range itself may still
  // be raw timestamps (e.g. "now" as the TODAY preset's upper bound).
  async getSalesSummary(range: DateRange, rolloverHour = 0): Promise<SalesSummary> {
    // Real incident (2026-08-12) — see lib/business-date.ts's
    // widenToBusinessDateRangeStart for the full story. range.from may
    // already be an exact business-date value (resolveDateRange's TODAY
    // preset computes it via computeBusinessDate itself) or a genuinely
    // raw timestamp that still needs widening (a multi-day preset, or an
    // ad-hoc narrow window) — this handles both without double-applying
    // the rollover-hour rollback.
    const inRange = {
      gte: widenToBusinessDateRangeStart(range.from, rolloverHour),
      lte: computeBusinessDate(range.to, rolloverHour),
    };
    const where: Prisma.SaleWhereInput = { status: "COMPLETED", businessDate: inRange };

    const [
      totals,
      byCategory,
      byPaymentMethod,
      byEmployee,
      paymentMethods,
      employees,
      openPlayRegular,
      openPlayUnli,
    ] = await Promise.all([
      prisma.sale.aggregate({ where, _sum: { amountCents: true }, _count: true }),
      prisma.sale.groupBy({ by: ["category"], where, _sum: { amountCents: true }, _count: true }),
      prisma.sale.groupBy({
        by: ["paymentMethodId"],
        where,
        _sum: { amountCents: true },
        _count: true,
      }),
      prisma.sale.groupBy({
        by: ["employeeId"],
        where,
        _sum: { amountCents: true },
        _count: true,
      }),
      prisma.paymentMethod.findMany(),
      prisma.employee.findMany(),
      // "Regular" (pay-per-game/tab) vs "Unli" (flat Fri/Sat access fee) —
      // see OpenPlaySummaryCategory's own comment above.
      prisma.sale.aggregate({
        where: { ...where, category: "OPEN_PLAY", playerTabId: { not: null } },
        _sum: { amountCents: true },
        _count: true,
      }),
      prisma.sale.aggregate({
        where: { ...where, category: "OPEN_PLAY", openPlayNightRegistrationId: { not: null } },
        _sum: { amountCents: true },
        _count: true,
      }),
    ]);

    const totalAmountCents = totals._sum.amountCents ?? 0;
    const transactionCount = totals._count;
    const averageAmountCents =
      transactionCount > 0 ? Math.round(totalAmountCents / transactionCount) : 0;

    const paymentMethodById = new Map(paymentMethods.map((method) => [method.id, method]));
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

    return {
      totalAmountCents,
      transactionCount,
      averageAmountCents,
      byCategory: byCategory
        .flatMap((row): SalesSummaryCategoryBreakdown[] => {
          if (row.category !== "OPEN_PLAY") {
            return [
              { category: row.category, amountCents: row._sum.amountCents ?? 0, count: row._count },
            ];
          }
          const rows: SalesSummaryCategoryBreakdown[] = [];
          if (openPlayRegular._count > 0) {
            rows.push({
              category: "OPEN_PLAY_REGULAR",
              amountCents: openPlayRegular._sum.amountCents ?? 0,
              count: openPlayRegular._count,
            });
          }
          if (openPlayUnli._count > 0) {
            rows.push({
              category: "OPEN_PLAY_UNLI",
              amountCents: openPlayUnli._sum.amountCents ?? 0,
              count: openPlayUnli._count,
            });
          }
          return rows;
        })
        .sort((a, b) => {
          const orderA = SaleService.CATEGORY_DISPLAY_ORDER.indexOf(a.category);
          const orderB = SaleService.CATEGORY_DISPLAY_ORDER.indexOf(b.category);
          if (orderA === -1 && orderB === -1) return a.category.localeCompare(b.category);
          if (orderA === -1) return 1;
          if (orderB === -1) return -1;
          return orderA - orderB;
        }),
      byPaymentMethod: byPaymentMethod.map((row) => ({
        paymentMethodId: row.paymentMethodId,
        label: paymentMethodById.get(row.paymentMethodId)?.label ?? "Unknown",
        amountCents: row._sum.amountCents ?? 0,
        count: row._count,
      })),
      byEmployee: byEmployee.map((row) => {
        const employee = employeeById.get(row.employeeId);
        return {
          employeeId: row.employeeId,
          employeeNumber: employee?.employeeNumber ?? "Unknown",
          name: employee ? `${employee.firstName} ${employee.lastName}` : "Unknown",
          amountCents: row._sum.amountCents ?? 0,
          count: row._count,
        };
      }),
    };
  }

  // Powers the Operations Workspace's My Shift panel — how much the
  // signed-in employee has personally rung up so far during their
  // currently open shift.
  async getSalesForShift(shiftId: string): Promise<ShiftSalesSummary> {
    const result = await prisma.sale.aggregate({
      where: { shiftId, status: "COMPLETED" },
      _sum: { amountCents: true },
      _count: true,
    });

    return {
      totalAmountCents: result._sum.amountCents ?? 0,
      transactionCount: result._count,
    };
  }

  // Reported live: manual sales (category OTHER — an arbitrary amount
  // recorded for revenue outside every modelled flow) need to be
  // visibly distinguishable, not blended into the shift's plain total —
  // a shift with several of these is itself a signal something isn't
  // being captured properly. Itemized (not aggregated, unlike
  // getSalesForShift above) so staff can see each one's note before
  // closing out.
  async listManualSalesForShift(shiftId: string): Promise<Sale[]> {
    return prisma.sale.findMany({
      where: { shiftId, category: "OTHER", status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
    });
  }

  // Gate 1 (shift cash reconciliation): the cash-only counterpart to
  // getSalesForShift above — everything that method sums across every
  // payment method, this narrows to just PaymentMethod.key = "CASH".
  // Powers "expected cash" on the close-shift screen: openingCashCents +
  // this = what the drawer should hold before staff count it.
  async getCashSalesForShift(shiftId: string): Promise<ShiftSalesSummary> {
    const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
    const result = await prisma.sale.aggregate({
      where: { shiftId, status: "COMPLETED", paymentMethodId: cashMethod.id },
      _sum: { amountCents: true },
      _count: true,
    });

    return {
      totalAmountCents: result._sum.amountCents ?? 0,
      transactionCount: result._count,
    };
  }

  // GCash reconciliation Gate 1: date-scoped (not shift-scoped, unlike
  // getCashSalesForShift above) — GCash is one shared account balance
  // for the whole business, so this sums every GCash Sale across every
  // shift attributed to the given business day.
  //
  // Owner-directed consolidation (2026-08-12): filters on Sale.
  // businessDate directly now (set once, at creation — see that
  // column's own schema comment), not a hand-computed createdAt range —
  // `date` is expected to already be a real business-date value (what
  // GcashDailyBalance.date holds), so this is now an exact match, no
  // rollover-hour math needed here at all.
  //
  // Real incident (2026-08-08): a shift spanning midnight (started Aug 6
  // evening, closed 12:32 AM Aug 7) had its physical closing count
  // confirmed as AUG 6's reconciliation ending balance — at 12:54 AM,
  // AFTER those last few post-midnight sales already happened. That
  // confirmed figure already included them. This function, called again
  // for Aug 7, counted the exact same sales a second time. businessDate
  // now correctly buckets those sales under Aug 6 in the first place
  // (same rollover-hour logic the confirmed balance itself should be
  // keyed by), but excludeBefore stays as a second, independent guard —
  // a genuinely late confirmation (staff didn't click Confirm until
  // well after the day's real close) is a "was this physically counted
  // already" question, not a "which day does it belong to" one, and
  // businessDate alone can't answer that. Optional and unused by any
  // other caller — every existing behavior is unchanged when omitted.
  async getGcashSalesForDate(date: Date, excludeBefore?: Date): Promise<number> {
    const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

    const result = await prisma.sale.aggregate({
      where: {
        status: "COMPLETED",
        paymentMethodId: gcashMethod.id,
        businessDate: date,
        ...(excludeBefore ? { createdAt: { gte: excludeBefore } } : {}),
      },
      _sum: { amountCents: true },
    });

    return result._sum.amountCents ?? 0;
  }

  // Cash's twin of getGcashSalesForDate above — same date-scoped (not
  // shift-scoped) shape, for the new day-level Cash reconciliation
  // (services/cash/cash-reconciliation.service.ts). Not the same thing
  // as getCashSalesForShift above, which is per-shift for the drawer
  // handoff reconciliation that already exists on Shift. See
  // getGcashSalesForDate's own comment for businessDate/excludeBefore.
  async getCashSalesForDate(date: Date, excludeBefore?: Date): Promise<number> {
    const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

    const result = await prisma.sale.aggregate({
      where: {
        status: "COMPLETED",
        paymentMethodId: cashMethod.id,
        businessDate: date,
        ...(excludeBefore ? { createdAt: { gte: excludeBefore } } : {}),
      },
      _sum: { amountCents: true },
    });

    return result._sum.amountCents ?? 0;
  }

  async listPaymentMethods(includeInactive = false): Promise<PaymentMethod[]> {
    return prisma.paymentMethod.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
  }

  async createPaymentMethod(
    input: UpsertPaymentMethodInput,
    actorUserId: string,
  ): Promise<PaymentMethod> {
    const method = await prisma.paymentMethod.create({
      data: { key: input.key, label: input.label, sortOrder: input.sortOrder ?? 0 },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "payment_method.created",
      entityType: "PaymentMethod",
      entityId: method.id,
      newValues: method,
    });

    return method;
  }

  async updatePaymentMethod(
    id: string,
    input: { label?: string; sortOrder?: number },
    actorUserId: string,
  ): Promise<PaymentMethod> {
    const existing = await prisma.paymentMethod.findUniqueOrThrow({ where: { id } });

    const method = await prisma.paymentMethod.update({
      where: { id },
      data: { label: input.label, sortOrder: input.sortOrder },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "payment_method.updated",
      entityType: "PaymentMethod",
      entityId: method.id,
      oldValues: existing,
      newValues: method,
    });

    return method;
  }

  async setPaymentMethodActive(
    id: string,
    isActive: boolean,
    actorUserId: string,
  ): Promise<PaymentMethod> {
    const existing = await prisma.paymentMethod.findUniqueOrThrow({ where: { id } });

    const method = await prisma.paymentMethod.update({ where: { id }, data: { isActive } });

    await this.writeAuditLog({
      actorUserId,
      action: isActive ? "payment_method.enabled" : "payment_method.disabled",
      entityType: "PaymentMethod",
      entityId: method.id,
      oldValues: { isActive: existing.isActive },
      newValues: { isActive: method.isActive },
    });

    return method;
  }

  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          oldValues: toJsonValue(entry.oldValues),
          newValues: toJsonValue(entry.newValues),
        },
      });
    } catch (error) {
      logger.error(
        { err: error, action: entry.action, userId: entry.actorUserId },
        "Failed to write audit log entry",
      );
    }
  }
}

export const saleService = new SaleService();
