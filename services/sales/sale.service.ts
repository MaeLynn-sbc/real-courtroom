import type { PaymentMethod, Prisma, Sale } from "@/lib/generated/prisma/client";
import type { SaleCategory, SaleSource } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
import type { DateRange } from "@/services/analytics/date-range";
import { formatSaleNumber } from "@/services/sales/sale-reference";

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

    return client.sale.create({
      data: {
        saleNumber,
        createdAt: now,
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

  async getSalesSummary(range: DateRange): Promise<SalesSummary> {
    // Reported live (2026-08-07): an Open Play tab settled just after
    // midnight (closing out the PREVIOUS night's session) was showing up in
    // TODAY's revenue, even though it was already accounted for as part of
    // last night's count. Sale.createdAt is when the settlement was rung
    // up, not which night's session it was for — PlayerTab.date and
    // OpenPlayNightRegistration.date hold that already. So Open Play sales
    // are scoped by their linked session date instead of createdAt; every
    // other category (no such "which night" concept) keeps using
    // createdAt exactly as before.
    const inRange = { gte: range.from, lte: range.to };
    const where: Prisma.SaleWhereInput = {
      status: "COMPLETED",
      OR: [
        { category: { not: "OPEN_PLAY" }, createdAt: inRange },
        { category: "OPEN_PLAY", playerTabId: { not: null }, playerTab: { date: inRange } },
        {
          category: "OPEN_PLAY",
          openPlayNightRegistrationId: { not: null },
          openPlayNightRegistration: { date: inRange },
        },
      ],
    };

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
      // see OpenPlaySummaryCategory's own comment above. Scoped by session
      // date, same reasoning as `where` above.
      prisma.sale.aggregate({
        where: {
          status: "COMPLETED",
          category: "OPEN_PLAY",
          playerTabId: { not: null },
          playerTab: { date: inRange },
        },
        _sum: { amountCents: true },
        _count: true,
      }),
      prisma.sale.aggregate({
        where: {
          status: "COMPLETED",
          category: "OPEN_PLAY",
          openPlayNightRegistrationId: { not: null },
          openPlayNightRegistration: { date: inRange },
        },
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
  // shift that fell on the given calendar day, midnight to midnight.
  async getGcashSalesForDate(date: Date): Promise<number> {
    const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const startOfNextDay = new Date(startOfDay);
    startOfNextDay.setDate(startOfNextDay.getDate() + 1);

    const result = await prisma.sale.aggregate({
      where: {
        status: "COMPLETED",
        paymentMethodId: gcashMethod.id,
        createdAt: { gte: startOfDay, lt: startOfNextDay },
      },
      _sum: { amountCents: true },
    });

    return result._sum.amountCents ?? 0;
  }

  // Cash's twin of getGcashSalesForDate above — same date-scoped (not
  // shift-scoped) shape, for the new day-level Cash reconciliation
  // (services/cash/cash-reconciliation.service.ts). Not the same thing
  // as getCashSalesForShift above, which is per-shift for the drawer
  // handoff reconciliation that already exists on Shift.
  async getCashSalesForDate(date: Date): Promise<number> {
    const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const startOfNextDay = new Date(startOfDay);
    startOfNextDay.setDate(startOfNextDay.getDate() + 1);

    const result = await prisma.sale.aggregate({
      where: {
        status: "COMPLETED",
        paymentMethodId: cashMethod.id,
        createdAt: { gte: startOfDay, lt: startOfNextDay },
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
