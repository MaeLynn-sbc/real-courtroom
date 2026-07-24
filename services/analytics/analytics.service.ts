import { prisma } from "@/lib/prisma";
import type { DateRange } from "@/services/analytics/date-range";
import { equipmentService } from "@/services/equipment/equipment.service";
import { lockerService } from "@/services/lockers/locker.service";
import { reportingService } from "@/services/reporting/reporting.service";

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function bucketByDay<T>(items: T[], getDate: (item: T) => Date): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = dayKey(getDate(item));
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  return buckets;
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface EquipmentUtilizationRow {
  equipmentId: string;
  equipmentName: string;
  rentalsCount: number;
}

export interface LockerUtilizationResult {
  totalLockers: number;
  occupiedCount: number;
  availableCount: number;
  rentalsInRange: number;
}

export interface DashboardKpis {
  totalBookings: number;
  billableAmountCents: number;
  activeMemberships: number;
  newEnrollments: number;
  openPlaySessions: number;
  tournamentsInRange: number;
  equipmentRentalsActive: number;
  lockersOccupied: number;
  unresolvedAlerts: number;
}

// Trend/KPI queries — all computed live from operational data, nothing
// stored in a duplicate aggregate table. getDashboardKpis is the
// centralized KPI interface (recommendation #2): the dashboard page reads
// only this one object rather than each card computing its own stats.
export class AnalyticsService {
  async getCourtUtilizationTrend(range: DateRange): Promise<TrendPoint[]> {
    const bookings = await prisma.booking.findMany({
      where: {
        startAt: { gte: range.from, lte: range.to },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      select: { startAt: true, endAt: true },
    });

    const buckets = bucketByDay(bookings, (b) => b.startAt);
    return Array.from(buckets.entries())
      .map(([date, items]) => ({
        date,
        value: items.reduce((sum, b) => sum + (b.endAt.getTime() - b.startAt.getTime()) / 3_600_000, 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async getMembershipGrowth(range: DateRange): Promise<TrendPoint[]> {
    const enrollments = await prisma.membershipHistory.findMany({
      where: { createdAt: { gte: range.from, lte: range.to }, eventType: "ENROLLED" },
      select: { createdAt: true },
    });

    const buckets = bucketByDay(enrollments, (e) => e.createdAt);
    return Array.from(buckets.entries())
      .map(([date, items]) => ({ date, value: items.length }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async getPlayerActivity(range: DateRange): Promise<{ activePlayers: number }> {
    const [bookingPlayers, openPlayPlayers] = await Promise.all([
      prisma.booking.findMany({
        where: { startAt: { gte: range.from, lte: range.to }, playerId: { not: null } },
        select: { playerId: true },
        distinct: ["playerId"],
      }),
      prisma.openPlayRegistration.findMany({
        where: { registeredAt: { gte: range.from, lte: range.to }, playerId: { not: null } },
        select: { playerId: true },
        distinct: ["playerId"],
      }),
    ]);

    const activePlayerIds = new Set<string>();
    for (const b of bookingPlayers) {
      if (b.playerId) activePlayerIds.add(b.playerId);
    }
    for (const r of openPlayPlayers) {
      if (r.playerId) activePlayerIds.add(r.playerId);
    }

    return { activePlayers: activePlayerIds.size };
  }

  // Phase 7 review: previously read the old, dormant OpenPlaySession model
  // via reportingService.getOpenPlayReport (removed — see that method's
  // former location and features/reports/schemas/report.schema.ts's
  // comment). Rewired here to the real Open Play Nights feature —
  // OpenPlayNightSession/OpenPlayNightRegistration — rather than deleting
  // this KPI outright.
  async getOpenPlayParticipation(
    range: DateRange,
  ): Promise<{ sessionsCount: number; registrationsCount: number; checkedInCount: number }> {
    const [sessionsCount, registrationsCount, checkedInCount] = await Promise.all([
      prisma.openPlayNightSession.count({ where: { date: { gte: range.from, lte: range.to } } }),
      prisma.openPlayNightRegistration.count({ where: { date: { gte: range.from, lte: range.to } } }),
      prisma.openPlayNightRegistration.count({
        where: { date: { gte: range.from, lte: range.to }, checkedInAt: { not: null } },
      }),
    ]);
    return { sessionsCount, registrationsCount, checkedInCount };
  }

  async getTournamentParticipation(
    range: DateRange,
  ): Promise<{ tournamentsCount: number; registrationsCount: number }> {
    const tournaments = await reportingService.getTournamentReport(range);
    return {
      tournamentsCount: tournaments.length,
      registrationsCount: tournaments.reduce((sum, t) => sum + t.registrationsCount, 0),
    };
  }

  async getEquipmentUtilization(range: DateRange): Promise<EquipmentUtilizationRow[]> {
    const rentals = await prisma.equipmentRental.findMany({
      where: { rentedAt: { gte: range.from, lte: range.to } },
      select: { equipmentId: true, equipment: { select: { name: true } } },
    });

    const byEquipment = new Map<string, EquipmentUtilizationRow>();
    for (const rental of rentals) {
      const existing = byEquipment.get(rental.equipmentId) ?? {
        equipmentId: rental.equipmentId,
        equipmentName: rental.equipment.name,
        rentalsCount: 0,
      };
      existing.rentalsCount += 1;
      byEquipment.set(rental.equipmentId, existing);
    }

    return Array.from(byEquipment.values()).sort((a, b) => b.rentalsCount - a.rentalsCount);
  }

  async getLockerUtilization(range: DateRange): Promise<LockerUtilizationResult> {
    const [lockers, rentalsInRange] = await Promise.all([
      lockerService.listLockers(),
      prisma.lockerRental.count({ where: { startAt: { gte: range.from, lte: range.to } } }),
    ]);

    const occupiedCount = lockers.filter((l) => l.displayStatus === "OCCUPIED").length;

    return {
      totalLockers: lockers.length,
      occupiedCount,
      availableCount: lockers.filter((l) => l.displayStatus === "AVAILABLE").length,
      rentalsInRange,
    };
  }

  async getDashboardKpis(range: DateRange): Promise<DashboardKpis> {
    // Fetched once, up front, and threaded into getRevenueReport below
    // instead of letting it (and getTournamentParticipation) each
    // independently re-fetch the same booking/tournament rows — see
    // reporting.service.ts's getRevenueReport comment.
    const [bookingReport, tournamentReport] = await Promise.all([
      reportingService.getBookingReport(range),
      reportingService.getTournamentReport(range),
    ]);

    const [revenueReport, activeMemberships, membershipGrowth, openPlayParticipation, equipmentSummary, lockerUtilization] =
      await Promise.all([
        reportingService.getRevenueReport(range, { bookingReport, tournamentReport }),
        prisma.membership.count({ where: { status: "ACTIVE" } }),
        this.getMembershipGrowth(range),
        this.getOpenPlayParticipation(range),
        equipmentService.getInventorySummary(),
        this.getLockerUtilization(range),
      ]);

    return {
      totalBookings: bookingReport.totalBookings,
      billableAmountCents: revenueReport.totalAmountCents,
      activeMemberships,
      newEnrollments: membershipGrowth.reduce((sum, point) => sum + point.value, 0),
      openPlaySessions: openPlayParticipation.sessionsCount,
      tournamentsInRange: tournamentReport.length,
      equipmentRentalsActive: equipmentSummary.rentedCount,
      lockersOccupied: lockerUtilization.occupiedCount,
      unresolvedAlerts: equipmentSummary.damagedCount + equipmentSummary.overdueCount,
    };
  }
}

export const analyticsService = new AnalyticsService();
