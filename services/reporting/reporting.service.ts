import { computeBusinessDate, widenToBusinessDateRangeStart } from "@/lib/business-date";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { DateRange } from "@/services/analytics/date-range";

function playerDisplayName(
  player: { user: { name: string | null; email: string | null } } | null,
  guestName: string | null,
): string | null {
  if (player) {
    return player.user.name ?? player.user.email;
  }
  return guestName;
}

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60);
}

// --- Booking report ---------------------------------------------------------

export interface BookingReportRow {
  id: string;
  bookingReference: string;
  courtName: string;
  playerName: string | null;
  type: string;
  status: string;
  startAt: Date;
  endAt: Date;
  totalAmountCents: number;
}

export interface BookingReportResult {
  rows: BookingReportRow[];
  totalBookings: number;
  totalAmountCents: number;
  byStatus: Record<string, number>;
}

// --- Court utilization report ------------------------------------------------

export interface CourtUtilizationRow {
  courtId: string;
  courtName: string;
  bookingsCount: number;
  bookedHours: number;
}

// "Open Play report" removed here (Phase 7 review) — it read from the old,
// dormant OpenPlaySession model (a different, inactive rotation feature —
// see prisma/schema.prisma's comment above OpenPlayNightSession) and
// rendered plausible-looking but wrong numbers for the current Open Play
// Nights feature. Not repaired: a correct open-play report now lives at
// /dashboard/sales (services/open-play/open-play-sales.service.ts), which
// reads the real PlayerTab/GameAssignment/Sale data this feature actually
// produces.

// --- Tournament report -------------------------------------------------------

export interface TournamentReportRow {
  id: string;
  name: string;
  status: string;
  startDate: Date;
  endDate: Date;
  registrationsCount: number;
  confirmedRegistrationsCount: number;
  matchesPlayed: number;
  feeRevenueCents: number;
}

// --- Membership report -------------------------------------------------------

export interface MembershipReportRow {
  id: string;
  membershipReference: string;
  playerName: string;
  planName: string;
  status: string;
  startDate: Date;
  endDate: Date;
}

export interface MembershipReportResult {
  rows: MembershipReportRow[];
  totalMemberships: number;
  byStatus: Record<string, number>;
  newEnrollmentsInRange: number;
  renewalsInRange: number;
}

// --- Coaching report -----------------------------------------------------

export interface CoachingReportRow {
  id: string;
  sessionReference: string;
  coachId: string;
  coachName: string;
  playerName: string | null;
  bookingReference: string;
  courtName: string;
  status: string;
  startAt: Date;
  rateCents: number;
}

export interface CoachingReportResult {
  rows: CoachingReportRow[];
  totalSessions: number;
  totalFeeCentsExcludingCancelled: number;
}

export interface CoachingFeesByCoachRow {
  coachId: string;
  coachName: string;
  transactionCount: number;
  amountCents: number;
}

// --- Equipment rental report --------------------------------------------------

export interface EquipmentRentalReportRow {
  id: string;
  rentalReference: string;
  equipmentName: string;
  playerName: string;
  status: string;
  rentedAt: Date;
  dueAt: Date | null;
  returnedAt: Date | null;
  billableAmountCents: number;
}

// --- Locker rental report ----------------------------------------------------

export interface LockerRentalReportRow {
  id: string;
  rentalReference: string;
  lockerCode: string;
  playerName: string;
  type: string;
  status: string;
  startAt: Date;
  endAt: Date;
  amountCents: number;
}

// --- Daily reconciliation report (owner request, 2026-09-04) -----------------
//
// "if i export 30 days there would be daily sales reporting with variance
// and all. like complete report" — one row per business day, sales split
// by tender, with each ledger's starting/expected/counted/variance read
// straight from the confirmed balance rows.
//
// Every *Cents figure below is nullable EXCEPT the sales ones. A null
// means no balance row exists for that day — nobody opened that till —
// which is deliberately distinct from a zero. Rendering it as 0 would
// make an unopened day look like a perfectly balanced one.
export interface DailyReconciliationRow {
  date: Date;
  transactionCount: number;
  totalSalesCents: number;
  cashSalesCents: number;
  gcashSalesCents: number;
  otherSalesCents: number;
  cashStartingCents: number | null;
  cashExpectedCents: number | null;
  cashCountedCents: number | null;
  cashVarianceCents: number | null;
  cashStatus: string | null;
  gcashStartingCents: number | null;
  gcashExpectedCents: number | null;
  gcashCountedCents: number | null;
  gcashVarianceCents: number | null;
  gcashStatus: string | null;
}

// --- Sales by category / payment method reports (v1.1 Sub-phase 3) -----------

export interface SalesByCategoryRow {
  category: string;
  transactionCount: number;
  amountCents: number;
}

export interface SalesByPaymentMethodRow {
  paymentMethodLabel: string;
  transactionCount: number;
  amountCents: number;
}

export interface SalesByProductRow {
  productName: string;
  transactionCount: number;
  quantitySold: number;
  amountCents: number;
}

// productService.sellProduct is the only place a PRODUCT-category Sale
// is ever created, and it always writes description as either the bare
// product name (qty 1) or "{name} x{quantity}" — no separate quantity
// column exists on Sale, so this is the one reliable way to recover the
// historical unit count (amountCents / product.priceCents would be wrong
// once a product's price ever changes).
function parseProductQuantity(description: string | null): number {
  const match = description?.match(/ x(\d+)$/);
  return match ? Number(match[1]) : 1;
}

// --- Revenue-ready operational report -----------------------------------------
// Reported live (2026-08-02): Booking previously used its own module-
// native totalAmountCents ("billable," counting CONFIRMED-but-unpaid
// bookings too), while Product/Coaching/Open play were already Sale-
// sourced ("collected") — an inconsistent mix that didn't reconcile
// against the actual cash/GCash on hand. All four are now Sale-sourced,
// same COMPLETED-in-range predicate as getSalesByCategoryReport, so
// totalAmountCents genuinely means "money that came in," matching
// cashAmountCents + gcashAmountCents (+ any other payment method) below.
// An unpaid or still-pending booking correctly contributes ₱0 here —
// see the separate Booking report (getBookingReport) for billable/
// pending amounts, which is a different, legitimate question.
//
// Open play is split regular (weeknight, uncapped) vs unli (Fri/Sat
// capacity night) — same sessionId-null-vs-not fork PlayerTab and
// OpenPlayNightRegistration already use elsewhere in this codebase, per
// owner request; needs its own query since a plain groupBy can't
// express that join.
export interface RevenueReportResult {
  bookingAmountCents: number;
  productAmountCents: number;
  coachingAmountCents: number;
  regularOpenPlayAmountCents: number;
  unliOpenPlayAmountCents: number;
  openPlayAmountCents: number;
  cashAmountCents: number;
  gcashAmountCents: number;
  totalAmountCents: number;
}

// See getCashPositionSummary's own comment for why starting balances are
// nullable (no daily-balance row yet) while cashDepositedCents is a plain
// number (a range with no rows sums to a real, correct 0).
export interface CashPositionSummaryResult {
  cashStartingBalanceCents: number | null;
  cashDepositedCents: number;
  gcashStartingBalanceCents: number | null;
}

export class ReportingService {
  async getBookingReport(range: DateRange): Promise<BookingReportResult> {
    const bookings = await prisma.booking.findMany({
      where: { startAt: { gte: range.from, lte: range.to } },
      include: {
        court: { select: { name: true } },
        player: { include: { user: { select: { name: true, email: true } } } },
      },
      orderBy: { startAt: "desc" },
      take: 500,
    });

    const rows: BookingReportRow[] = bookings.map((booking) => ({
      id: booking.id,
      bookingReference: booking.bookingReference,
      courtName: booking.court.name,
      playerName: playerDisplayName(booking.player, booking.guestName),
      type: booking.type,
      status: booking.status,
      startAt: booking.startAt,
      endAt: booking.endAt,
      totalAmountCents: booking.totalAmountCents ?? 0,
    }));

    const byStatus: Record<string, number> = {};
    let totalAmountCents = 0;
    for (const row of rows) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      if (row.status !== "CANCELLED" && row.status !== "NO_SHOW") {
        totalAmountCents += row.totalAmountCents;
      }
    }

    return { rows, totalBookings: rows.length, totalAmountCents, byStatus };
  }

  async getCourtUtilizationReport(range: DateRange): Promise<CourtUtilizationRow[]> {
    const bookings = await prisma.booking.findMany({
      where: {
        startAt: { gte: range.from, lte: range.to },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      select: { startAt: true, endAt: true, court: { select: { id: true, name: true } } },
      take: 500,
    });

    const byCourt = new Map<string, CourtUtilizationRow>();
    for (const booking of bookings) {
      const existing = byCourt.get(booking.court.id) ?? {
        courtId: booking.court.id,
        courtName: booking.court.name,
        bookingsCount: 0,
        bookedHours: 0,
      };
      existing.bookingsCount += 1;
      existing.bookedHours += hoursBetween(booking.startAt, booking.endAt);
      byCourt.set(booking.court.id, existing);
    }

    return Array.from(byCourt.values()).sort((a, b) => b.bookedHours - a.bookedHours);
  }

  async getTournamentReport(range: DateRange): Promise<TournamentReportRow[]> {
    const tournaments = await prisma.tournament.findMany({
      where: { startDate: { gte: range.from, lte: range.to } },
      include: {
        categories: {
          include: {
            registrations: { select: { status: true } },
            matches: { select: { id: true } },
          },
        },
      },
      orderBy: { startDate: "desc" },
      take: 500,
    });

    return tournaments.map((tournament) => {
      let registrationsCount = 0;
      let confirmedRegistrationsCount = 0;
      let matchesPlayed = 0;
      let feeRevenueCents = 0;

      for (const category of tournament.categories) {
        registrationsCount += category.registrations.length;
        const confirmed = category.registrations.filter((r) => r.status === "CONFIRMED").length;
        confirmedRegistrationsCount += confirmed;
        matchesPlayed += category.matches.length;
        feeRevenueCents += confirmed * category.feeCents;
      }

      return {
        id: tournament.id,
        name: tournament.name,
        status: tournament.status,
        startDate: tournament.startDate,
        endDate: tournament.endDate,
        registrationsCount,
        confirmedRegistrationsCount,
        matchesPlayed,
        feeRevenueCents,
      };
    });
  }

  async getMembershipReport(range: DateRange): Promise<MembershipReportResult> {
    const [memberships, historyInRange] = await Promise.all([
      // Phase 10: was unconditional (loaded the entire Membership table on
      // every call, the worst offender the audit found) — scoped to
      // memberships whose active window overlaps the report range, the
      // same "in range" semantics every other report method already uses.
      prisma.membership.findMany({
        where: { startDate: { lte: range.to }, endDate: { gte: range.from } },
        include: {
          player: { include: { user: { select: { name: true, email: true } } } },
          membershipPlan: { select: { name: true } },
        },
        orderBy: { startDate: "desc" },
        take: 500,
      }),
      prisma.membershipHistory.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        select: { eventType: true },
      }),
    ]);

    const rows: MembershipReportRow[] = memberships.map((membership) => ({
      id: membership.id,
      membershipReference: membership.membershipReference,
      playerName: membership.player.user.name ?? membership.player.user.email ?? "Unknown player",
      planName: membership.membershipPlan.name,
      status: membership.status,
      startDate: membership.startDate,
      endDate: membership.endDate,
    }));

    const byStatus: Record<string, number> = {};
    for (const row of rows) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    }

    return {
      rows,
      totalMemberships: rows.length,
      byStatus,
      newEnrollmentsInRange: historyInRange.filter((h) => h.eventType === "ENROLLED").length,
      renewalsInRange: historyInRange.filter((h) => h.eventType === "RENEWED").length,
    };
  }

  // Date-ranged by the linked booking's startAt — a coach session's own
  // "when" is the court time it was attached to, same as the booking
  // report right above filters by.
  //
  // Owner request (2026-08-04): "if cancellation means no pay, then it
  // shouldn't be there in the first place" — a CANCELLED session never
  // gets a Sale (the live paths only record one for a non-cancelled
  // session, see coach-session-fee-sale.ts), so `sale: { isNot: null }`
  // is a single condition that means "confirmed AND actually paid" —
  // exactly what was asked. This used to show every session in range,
  // cancelled-or-not, with CANCELLED ones excluded only from the total,
  // not the row list itself.
  async getCoachingReport(range: DateRange): Promise<CoachingReportResult> {
    const sessions = await prisma.coachSession.findMany({
      where: {
        booking: { startAt: { gte: range.from, lte: range.to } },
        sale: { isNot: null },
      },
      include: {
        coach: true,
        player: { include: { user: { select: { name: true, email: true } } } },
        booking: { include: { court: { select: { name: true } } } },
      },
      orderBy: { booking: { startAt: "desc" } },
      take: 500,
    });

    const rows: CoachingReportRow[] = sessions.map((session) => ({
      id: session.id,
      sessionReference: session.sessionReference,
      coachId: session.coachId,
      coachName: `${session.coach.firstName} ${session.coach.lastName}`,
      playerName: playerDisplayName(session.player, session.guestName),
      bookingReference: session.booking.bookingReference,
      courtName: session.booking.court.name,
      status: session.status,
      startAt: session.booking.startAt,
      rateCents: session.rateCents,
    }));

    const totalFeeCentsExcludingCancelled = rows
      .filter((row) => row.status !== "CANCELLED")
      .reduce((sum, row) => sum + row.rateCents, 0);

    return { rows, totalSessions: rows.length, totalFeeCentsExcludingCancelled };
  }

  // Owner request (2026-08-04): "separate the booking fees of coach
  // Dhudz and Tito Voi so their income will be given separately." Built
  // on real COACHING-category Sale rows, NOT CoachSession rows the way
  // getCoachingReport's totalFeeCentsExcludingCancelled is — a coach
  // session can be CONFIRMED with nothing actually collected yet
  // (payment proof still pending, or never settled), and this figure
  // must answer "how much do I actually owe this coach," not "how much
  // is scheduled." Grouped in JS, not a Prisma groupBy — coachSession.
  // coach is a nested relation, which groupBy can't traverse directly.
  async getCoachingFeesByCoachReport(range: DateRange): Promise<CoachingFeesByCoachRow[]> {
    const sales = await prisma.sale.findMany({
      where: {
        category: "COACHING",
        createdAt: { gte: range.from, lte: range.to },
        status: "COMPLETED",
      },
      select: {
        amountCents: true,
        coachSession: { select: { coach: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });

    const byCoach = new Map<string, CoachingFeesByCoachRow>();
    for (const sale of sales) {
      const coach = sale.coachSession?.coach;
      if (!coach) continue; // every COACHING Sale has a coachSessionId — defensive only
      const existing = byCoach.get(coach.id);
      if (existing) {
        existing.transactionCount += 1;
        existing.amountCents += sale.amountCents;
      } else {
        byCoach.set(coach.id, {
          coachId: coach.id,
          coachName: `${coach.firstName} ${coach.lastName}`,
          transactionCount: 1,
          amountCents: sale.amountCents,
        });
      }
    }

    return Array.from(byCoach.values()).sort((a, b) => b.amountCents - a.amountCents);
  }

  async getEquipmentRentalReport(range: DateRange): Promise<EquipmentRentalReportRow[]> {
    const rentals = await prisma.equipmentRental.findMany({
      where: { rentedAt: { gte: range.from, lte: range.to } },
      include: {
        equipment: { select: { name: true, rentalRateCents: true } },
        player: { include: { user: { select: { name: true, email: true } } } },
      },
      orderBy: { rentedAt: "desc" },
      take: 500,
    });

    return rentals.map((rental) => ({
      id: rental.id,
      rentalReference: rental.rentalReference,
      equipmentName: rental.equipment.name,
      playerName: rental.player.user.name ?? rental.player.user.email ?? "Unknown player",
      status: rental.status,
      rentedAt: rental.rentedAt,
      dueAt: rental.dueAt,
      returnedAt: rental.returnedAt,
      billableAmountCents: rental.equipment.rentalRateCents + rental.lateFeeCents,
    }));
  }

  async getLockerRentalReport(range: DateRange): Promise<LockerRentalReportRow[]> {
    const rentals = await prisma.lockerRental.findMany({
      where: { startAt: { gte: range.from, lte: range.to } },
      include: {
        locker: { select: { code: true } },
        player: { include: { user: { select: { name: true, email: true } } } },
      },
      orderBy: { startAt: "desc" },
      take: 500,
    });

    return rentals.map((rental) => ({
      id: rental.id,
      rentalReference: rental.rentalReference,
      lockerCode: rental.locker.code,
      playerName: rental.player.user.name ?? rental.player.user.email ?? "Unknown player",
      type: rental.type,
      status: rental.status,
      startAt: rental.startAt,
      endAt: rental.endAt,
      amountCents: rental.amountCents,
    }));
  }

  // --- Sales by category / payment method reports -----------------------
  // v1.1 Sub-phase 3: genuinely Sale-sourced (unlike getRevenueReport
  // below, which derives "billable amount" from each module's own amount
  // fields and predates the Sale model) — only counts transactions that
  // actually went through SaleService, i.e. the shift-gated Reception
  // flow. Deliberately kept separate from getRevenueReport rather than
  // replacing it, since the two can legitimately disagree (e.g. a row
  // created outside the Sale-integrated action paths).

  async getSalesByCategoryReport(range: DateRange, rolloverHour = 0): Promise<SalesByCategoryRow[]> {
    const rows = await prisma.sale.groupBy({
      by: ["category"],
      where: this.dateAwareSaleWhere(range, rolloverHour),
      _sum: { amountCents: true },
      _count: true,
      orderBy: { category: "asc" },
    });

    return rows.map((row) => ({
      category: row.category,
      transactionCount: row._count,
      amountCents: row._sum.amountCents ?? 0,
    }));
  }

  async getSalesByPaymentMethodReport(
    range: DateRange,
    rolloverHour = 0,
  ): Promise<SalesByPaymentMethodRow[]> {
    const [rows, paymentMethods] = await Promise.all([
      prisma.sale.groupBy({
        by: ["paymentMethodId"],
        where: this.dateAwareSaleWhere(range, rolloverHour),
        _sum: { amountCents: true },
        _count: true,
      }),
      prisma.paymentMethod.findMany(),
    ]);
    const paymentMethodById = new Map(paymentMethods.map((method) => [method.id, method]));

    return rows
      .map((row) => ({
        paymentMethodLabel: paymentMethodById.get(row.paymentMethodId)?.label ?? "Unknown",
        transactionCount: row._count,
        amountCents: row._sum.amountCents ?? 0,
      }))
      .sort((a, b) => b.amountCents - a.amountCents);
  }

  // Consignment accounting (2026-08-02 request): shirts/grips/etc. are
  // sold on consignment, so the owner needs per-product totals — not
  // just the lumped "Shop products" figure — to know what's owed back
  // to each supplier for a given day or range. Fetches raw rows rather
  // than groupBy since the historical quantity can only be recovered by
  // parsing each row's own description (see parseProductQuantity).
  async getSalesByProductReport(range: DateRange, rolloverHour = 0): Promise<SalesByProductRow[]> {
    // Real incident (2026-08-12) — see lib/business-date.ts's
    // widenToBusinessDateRangeStart for the full story.
    const sales = await prisma.sale.findMany({
      where: {
        category: "PRODUCT",
        status: "COMPLETED",
        businessDate: {
          gte: widenToBusinessDateRangeStart(range.from, rolloverHour),
          lte: computeBusinessDate(range.to, rolloverHour),
        },
        productId: { not: null },
      },
      select: {
        productId: true,
        description: true,
        amountCents: true,
        product: { select: { name: true } },
      },
    });

    const byProduct = new Map<string, SalesByProductRow>();
    for (const sale of sales) {
      const key = sale.productId!;
      const quantity = parseProductQuantity(sale.description);
      const existing = byProduct.get(key);
      if (existing) {
        existing.transactionCount += 1;
        existing.quantitySold += quantity;
        existing.amountCents += sale.amountCents;
      } else {
        byProduct.set(key, {
          productName: sale.product?.name ?? "Unknown product",
          transactionCount: 1,
          quantitySold: quantity,
          amountCents: sale.amountCents,
        });
      }
    }

    return [...byProduct.values()].sort((a, b) => b.amountCents - a.amountCents);
  }

  // Phase 10: accepts an already-fetched booking report so a caller that's
  // already computed one (analyticsService.getDashboardKpis fetches its
  // own anyway) doesn't pay for a duplicate query. Callers that just want
  // a self-contained revenue report (e.g. the /dashboard/reports page)
  // can still call this with only `range`.
  // OPEN_PLAY sales are linked one of two ways (see Sale.openPlayNightRegistrationId's
  // own schema comment): the Fri/Sat walk-in registration fee
  // (openPlayNightRegistrationId) or the queue/rotation tab settlement
  // (playerTabId), which covers both regular and unli nights. Both
  // PlayerTab and OpenPlayNightRegistration carry the same nullable
  // sessionId fork — null means regular (weeknight, uncapped), set
  // means unli (Fri/Sat, capacity-gated) — so tracing either link back
  // to its sessionId is enough to classify every OPEN_PLAY sale.
  // Owner-directed consolidation (2026-08-12): "one shared date
  // function... starting with the three copies of the same OR filter
  // across sale.service and reporting.service." Sale.businessDate
  // (set once, at creation — see that column's own schema comment)
  // replaces the join-based OR entirely; no join needed to find the
  // right day anymore, since every Sale already carries it. This is
  // the second of the three copies — see dateAwareSaleWhere below for
  // the third, and saleService.getSalesSummary for the first (already
  // fixed the same way).
  private async getOpenPlaySplit(
    range: DateRange,
    rolloverHour = 0,
  ): Promise<{ regularCents: number; unliCents: number }> {
    const sales = await prisma.sale.findMany({
      where: { ...this.dateAwareSaleWhere(range, rolloverHour), category: "OPEN_PLAY" },
      select: {
        amountCents: true,
        playerTab: { select: { sessionId: true } },
        openPlayNightRegistration: { select: { sessionId: true } },
      },
    });

    let regularCents = 0;
    let unliCents = 0;
    for (const sale of sales) {
      const sessionId =
        sale.playerTab?.sessionId ?? sale.openPlayNightRegistration?.sessionId ?? null;
      if (sessionId) {
        unliCents += sale.amountCents;
      } else {
        regularCents += sale.amountCents;
      }
    }
    return { regularCents, unliCents };
  }

  // Owner-directed consolidation (2026-08-12): the third of the three
  // copies (see getOpenPlaySplit above) — filters every category
  // uniformly on Sale.businessDate now, same as
  // saleService.getSalesSummary. Shared here (not re-typed per report)
  // so the category report, the payment-method report, and the revenue
  // summary can never drift apart from each other.
  // ONE ROW PER BUSINESS DAY — the month-end reconciliation sheet.
  //
  // Every other sales report in this file aggregates the whole range into
  // a handful of rows (by category, by method, by product). This is the
  // opposite shape: 30 days in, 30 rows out, so a variance can be traced
  // to the day it happened rather than disappearing into a total.
  //
  // NOTHING IS RECOMPUTED. Starting, expected, counted and variance are
  // read from CashDailyBalance / GcashDailyBalance exactly as staff
  // confirmed them on the day. Re-deriving them here would let the export
  // disagree with what was reconciled — the one thing a reconciliation
  // sheet must never do.
  //
  // Days with no balance row are still emitted, with nulls. A missing day
  // in a 30-day export usually means nobody opened the till, and that is
  // worth seeing rather than silently skipping.
  async getDailyReconciliationReport(
    range: DateRange,
    rolloverHour = 0,
  ): Promise<DailyReconciliationRow[]> {
    const from = widenToBusinessDateRangeStart(range.from, rolloverHour);
    const to = computeBusinessDate(range.to, rolloverHour);

    const [sales, cashBalances, gcashBalances] = await Promise.all([
      prisma.sale.groupBy({
        by: ["businessDate", "paymentMethodId"],
        where: this.dateAwareSaleWhere(range, rolloverHour),
        _sum: { amountCents: true },
        _count: true,
      }),
      prisma.cashDailyBalance.findMany({ where: { date: { gte: from, lte: to } } }),
      prisma.gcashDailyBalance.findMany({ where: { date: { gte: from, lte: to } } }),
    ]);

    const methods = await prisma.paymentMethod.findMany({ select: { id: true, key: true } });
    const methodKeyById = new Map(methods.map((m) => [m.id, m.key]));
    const cashByDate = new Map(cashBalances.map((b) => [b.date.getTime(), b]));
    const gcashByDate = new Map(gcashBalances.map((b) => [b.date.getTime(), b]));

    const salesByDate = new Map<
      number,
      { total: number; cash: number; gcash: number; other: number; count: number }
    >();
    for (const row of sales) {
      if (!row.businessDate) {
        continue;
      }
      const key = row.businessDate.getTime();
      const bucket = salesByDate.get(key) ?? { total: 0, cash: 0, gcash: 0, other: 0, count: 0 };
      const amount = row._sum.amountCents ?? 0;
      const methodKey = methodKeyById.get(row.paymentMethodId);
      bucket.total += amount;
      bucket.count += row._count;
      if (methodKey === "CASH") {
        bucket.cash += amount;
      } else if (methodKey === "GCASH") {
        bucket.gcash += amount;
      } else {
        bucket.other += amount;
      }
      salesByDate.set(key, bucket);
    }

    // Walk every calendar day in the range rather than only the days that
    // happen to have rows, so a day with no sales AND no till is still
    // visible as a gap.
    const rows: DailyReconciliationRow[] = [];
    for (const cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
      const key = cursor.getTime();
      const sale = salesByDate.get(key);
      const cash = cashByDate.get(key);
      const gcash = gcashByDate.get(key);
      rows.push({
        date: new Date(cursor),
        transactionCount: sale?.count ?? 0,
        totalSalesCents: sale?.total ?? 0,
        cashSalesCents: sale?.cash ?? 0,
        gcashSalesCents: sale?.gcash ?? 0,
        otherSalesCents: sale?.other ?? 0,
        cashStartingCents: cash?.startingBalanceCents ?? null,
        cashExpectedCents: cash?.expectedEndingBalanceCents ?? null,
        cashCountedCents: cash?.confirmedEndingBalanceCents ?? null,
        cashVarianceCents: cash?.varianceCents ?? null,
        cashStatus: cash?.status ?? null,
        gcashStartingCents: gcash?.startingBalanceCents ?? null,
        gcashExpectedCents: gcash?.expectedEndingBalanceCents ?? null,
        gcashCountedCents: gcash?.confirmedEndingBalanceCents ?? null,
        gcashVarianceCents: gcash?.varianceCents ?? null,
        gcashStatus: gcash?.status ?? null,
      });
    }
    return rows;
  }

  private dateAwareSaleWhere(range: DateRange, rolloverHour = 0): Prisma.SaleWhereInput {
    // Real incident (2026-08-12) — see lib/business-date.ts's
    // widenToBusinessDateRangeStart for the full story.
    return {
      status: "COMPLETED",
      businessDate: {
        gte: widenToBusinessDateRangeStart(range.from, rolloverHour),
        lte: computeBusinessDate(range.to, rolloverHour),
      },
    };
  }

  // Owner request (2026-08-08): "add in the account reports the amount of
  // money for deposit and the starting money" — the Reports page only
  // ever showed Sale-sourced revenue (Cash/GCash collected); it never
  // surfaced the drawer/float state itself, which lives on
  // CashDailyBalance/GcashDailyBalance instead (see those models' own
  // schema comments). "Starting balance" is the range's OPENING float —
  // the earliest daily-balance row on or after range.from, not a sum
  // across the range (summing floats across days would double-count the
  // same money as it carries forward night to night). "Deposited" is
  // Cash-only (withdrawnCents — cash physically pulled for the bank/safe,
  // see CashDailyBalance.withdrawnCents' own comment); GCash has no
  // physical-pull equivalent, so it only gets a starting balance. Both
  // starting-balance fields are null (not 0) when no daily-balance row
  // exists yet in range — a day nobody has opened the reconciliation page
  // for yet is genuinely "no data," not a real zero float.
  async getCashPositionSummary(range: DateRange): Promise<CashPositionSummaryResult> {
    const dateInRange = { gte: range.from, lte: range.to };
    const [firstCashBalance, cashWithdrawn, firstGcashBalance] = await Promise.all([
      prisma.cashDailyBalance.findFirst({
        where: { date: dateInRange },
        orderBy: { date: "asc" },
        select: { startingBalanceCents: true },
      }),
      prisma.cashDailyBalance.aggregate({
        where: { date: dateInRange },
        _sum: { withdrawnCents: true },
      }),
      prisma.gcashDailyBalance.findFirst({
        where: { date: dateInRange },
        orderBy: { date: "asc" },
        select: { startingBalanceCents: true },
      }),
    ]);

    return {
      cashStartingBalanceCents: firstCashBalance?.startingBalanceCents ?? null,
      cashDepositedCents: cashWithdrawn._sum.withdrawnCents ?? 0,
      gcashStartingBalanceCents: firstGcashBalance?.startingBalanceCents ?? null,
    };
  }

  async getRevenueReport(range: DateRange, rolloverHour = 0): Promise<RevenueReportResult> {
    const dateAwareWhere = this.dateAwareSaleWhere(range, rolloverHour);

    const [saleCategoryTotals, openPlaySplit, paymentMethodTotals, paymentMethods] =
      await Promise.all([
        // Same COMPLETED-in-range predicate as getSalesByCategoryReport
        // above — one groupBy covers three of the four, rather than a
        // separate query (and a separate chance to drift) per category.
        // OPEN_PLAY is excluded here — it needs the dedicated split query
        // below instead of a flat groupBy sum.
        prisma.sale.groupBy({
          by: ["category"],
          where: { category: { in: ["BOOKING", "PRODUCT", "COACHING"] }, ...dateAwareWhere },
          _sum: { amountCents: true },
        }),
        this.getOpenPlaySplit(range, rolloverHour),
        // Cash/GCash actually collected, across every category — same
        // predicate as getSalesByPaymentMethodReport, requested alongside
        // the category breakdown so the totals reconcile against the
        // physical drawer and the GCash balance directly.
        prisma.sale.groupBy({
          by: ["paymentMethodId"],
          where: dateAwareWhere,
          _sum: { amountCents: true },
        }),
        prisma.paymentMethod.findMany({ where: { key: { in: ["CASH", "GCASH"] } } }),
      ]);

    const amountByCategory = new Map(
      saleCategoryTotals.map((row) => [row.category, row._sum.amountCents ?? 0]),
    );
    const bookingAmountCents = amountByCategory.get("BOOKING") ?? 0;
    const productAmountCents = amountByCategory.get("PRODUCT") ?? 0;
    const coachingAmountCents = amountByCategory.get("COACHING") ?? 0;
    const openPlayAmountCents = openPlaySplit.regularCents + openPlaySplit.unliCents;

    const amountByPaymentMethodId = new Map(
      paymentMethodTotals.map((row) => [row.paymentMethodId, row._sum.amountCents ?? 0]),
    );
    const cashMethodId = paymentMethods.find((method) => method.key === "CASH")?.id;
    const gcashMethodId = paymentMethods.find((method) => method.key === "GCASH")?.id;
    const cashAmountCents = cashMethodId ? (amountByPaymentMethodId.get(cashMethodId) ?? 0) : 0;
    const gcashAmountCents = gcashMethodId ? (amountByPaymentMethodId.get(gcashMethodId) ?? 0) : 0;

    const totalAmountCents =
      bookingAmountCents + productAmountCents + coachingAmountCents + openPlayAmountCents;

    return {
      bookingAmountCents,
      productAmountCents,
      coachingAmountCents,
      regularOpenPlayAmountCents: openPlaySplit.regularCents,
      unliOpenPlayAmountCents: openPlaySplit.unliCents,
      openPlayAmountCents,
      cashAmountCents,
      gcashAmountCents,
      totalAmountCents,
    };
  }
}

export const reportingService = new ReportingService();
