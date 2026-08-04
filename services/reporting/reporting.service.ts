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
  // report right above filters by. CANCELLED sessions still appear as
  // rows (a real, if unbilled, event worth seeing in range) but are
  // excluded from totalFeeCentsExcludingCancelled, matching
  // getExpectedPaymentTotalCents' own CANCELLED exclusion rule.
  async getCoachingReport(range: DateRange): Promise<CoachingReportResult> {
    const sessions = await prisma.coachSession.findMany({
      where: { booking: { startAt: { gte: range.from, lte: range.to } } },
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

  async getSalesByCategoryReport(range: DateRange): Promise<SalesByCategoryRow[]> {
    const rows = await prisma.sale.groupBy({
      by: ["category"],
      where: { createdAt: { gte: range.from, lte: range.to }, status: "COMPLETED" },
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

  async getSalesByPaymentMethodReport(range: DateRange): Promise<SalesByPaymentMethodRow[]> {
    const [rows, paymentMethods] = await Promise.all([
      prisma.sale.groupBy({
        by: ["paymentMethodId"],
        where: { createdAt: { gte: range.from, lte: range.to }, status: "COMPLETED" },
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
  async getSalesByProductReport(range: DateRange): Promise<SalesByProductRow[]> {
    const sales = await prisma.sale.findMany({
      where: {
        category: "PRODUCT",
        status: "COMPLETED",
        createdAt: { gte: range.from, lte: range.to },
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
  private async getOpenPlaySplit(
    range: DateRange,
  ): Promise<{ regularCents: number; unliCents: number }> {
    const sales = await prisma.sale.findMany({
      where: {
        category: "OPEN_PLAY",
        status: "COMPLETED",
        createdAt: { gte: range.from, lte: range.to },
      },
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

  async getRevenueReport(range: DateRange): Promise<RevenueReportResult> {
    const [saleCategoryTotals, openPlaySplit, paymentMethodTotals, paymentMethods] =
      await Promise.all([
        // Same COMPLETED-in-range predicate as getSalesByCategoryReport
        // above — one groupBy covers three of the four, rather than a
        // separate query (and a separate chance to drift) per category.
        // OPEN_PLAY is excluded here — it needs the dedicated split query
        // below instead of a flat groupBy sum.
        prisma.sale.groupBy({
          by: ["category"],
          where: {
            category: { in: ["BOOKING", "PRODUCT", "COACHING"] },
            status: "COMPLETED",
            createdAt: { gte: range.from, lte: range.to },
          },
          _sum: { amountCents: true },
        }),
        this.getOpenPlaySplit(range),
        // Cash/GCash actually collected, across every category — same
        // predicate as getSalesByPaymentMethodReport, requested alongside
        // the category breakdown so the totals reconcile against the
        // physical drawer and the GCash balance directly.
        prisma.sale.groupBy({
          by: ["paymentMethodId"],
          where: { status: "COMPLETED", createdAt: { gte: range.from, lte: range.to } },
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
