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

// --- Open Play report --------------------------------------------------------

export interface OpenPlayReportRow {
  id: string;
  sessionReference: string;
  title: string | null;
  startAt: Date;
  status: string;
  registrationsCount: number;
  checkedInCount: number;
  matchesPlayed: number;
}

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

// --- Revenue-ready operational report -----------------------------------------
// "Billable amount," not "collected revenue" — Payment/Invoice exist in the
// schema but are never written to by any service (payment integration is
// out of scope every phase), so these sums come from each module's own
// amount fields instead. See ARCHITECTURE.md's Phase 9 addendum.

export interface RevenueReportResult {
  bookingAmountCents: number;
  tournamentFeeAmountCents: number;
  membershipAmountCents: number;
  equipmentRentalAmountCents: number;
  lockerRentalAmountCents: number;
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

  async getOpenPlayReport(range: DateRange): Promise<OpenPlayReportRow[]> {
    const sessions = await prisma.openPlaySession.findMany({
      where: { startAt: { gte: range.from, lte: range.to } },
      include: {
        registrations: { select: { status: true } },
        matches: { select: { id: true } },
      },
      orderBy: { startAt: "desc" },
      take: 500,
    });

    return sessions.map((session) => ({
      id: session.id,
      sessionReference: session.sessionReference,
      title: session.title,
      startAt: session.startAt,
      status: session.status,
      registrationsCount: session.registrations.length,
      checkedInCount: session.registrations.filter((r) => r.status === "CHECKED_IN").length,
      matchesPlayed: session.matches.length,
    }));
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

  // Phase 10: accepts already-fetched booking/tournament reports so a
  // caller that's already computed them (analyticsService.getDashboardKpis
  // fetches both anyway) doesn't pay for a duplicate query — confirmed
  // both were independently re-fetched on every dashboard load before this
  // change. Callers that just want a self-contained revenue report (e.g.
  // the /dashboard/reports page) can still call this with only `range`.
  async getRevenueReport(
    range: DateRange,
    precomputed?: { bookingReport?: BookingReportResult; tournamentReport?: TournamentReportRow[] },
  ): Promise<RevenueReportResult> {
    const [bookingReport, tournamentRows, membershipHistory, equipmentRentals, lockerRentals] =
      await Promise.all([
        precomputed?.bookingReport ?? this.getBookingReport(range),
        precomputed?.tournamentReport ?? this.getTournamentReport(range),
        prisma.membershipHistory.findMany({
          where: {
            createdAt: { gte: range.from, lte: range.to },
            eventType: { in: ["ENROLLED", "RENEWED", "UPGRADED"] },
          },
          include: { membershipPlan: { select: { priceCents: true } } },
          take: 500,
        }),
        prisma.equipmentRental.findMany({
          where: { rentedAt: { gte: range.from, lte: range.to } },
          include: { equipment: { select: { rentalRateCents: true } } },
          take: 500,
        }),
        prisma.lockerRental.findMany({
          where: { startAt: { gte: range.from, lte: range.to } },
          select: { amountCents: true },
          take: 500,
        }),
      ]);

    const tournamentFeeAmountCents = tournamentRows.reduce((sum, t) => sum + t.feeRevenueCents, 0);
    const membershipAmountCents = membershipHistory.reduce(
      (sum, h) => sum + (h.membershipPlan?.priceCents ?? 0),
      0,
    );
    const equipmentRentalAmountCents = equipmentRentals.reduce(
      (sum, r) => sum + r.equipment.rentalRateCents + r.lateFeeCents,
      0,
    );
    const lockerRentalAmountCents = lockerRentals.reduce((sum, r) => sum + r.amountCents, 0);

    const totalAmountCents =
      bookingReport.totalAmountCents +
      tournamentFeeAmountCents +
      membershipAmountCents +
      equipmentRentalAmountCents +
      lockerRentalAmountCents;

    return {
      bookingAmountCents: bookingReport.totalAmountCents,
      tournamentFeeAmountCents,
      membershipAmountCents,
      equipmentRentalAmountCents,
      lockerRentalAmountCents,
      totalAmountCents,
    };
  }
}

export const reportingService = new ReportingService();
