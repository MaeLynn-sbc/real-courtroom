import type { Court, Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
// Reused directly rather than reimplemented — Booking is frozen but this
// pure, dependency-free helper is safe to import from a new module (see
// ARCHITECTURE.md's Phase 5 addendum). "Right now" is checked as a
// zero-width interval against each conflict's [startAt, endAt) window.
import { hasTimeOverlap } from "@/services/booking/booking-availability";

// Dynamic, read-only court assignment: no OpenPlaySessionCourt join table.
// Any ACTIVE court not currently under maintenance, not currently booked,
// and not currently hosting another Open Play match is available. Reads
// Court/CourtMaintenance/Booking directly (never through Court
// Management's or Booking's service classes) — the same read-only pattern
// Booking used against Court Management in Phase 4.
export class CourtAssignmentService {
  // Phase 10: accepts an optional transaction client so
  // rotationEngine.startNextMatch can run this check inside its
  // Serializable transaction (against `tx`) — defaults to `prisma` so
  // every other existing caller (e.g. getQueueStats) is unaffected.
  async findAvailableCourt(client: Prisma.TransactionClient | typeof prisma = prisma): Promise<Court | null> {
    const availableCourts = await this.listAvailableCourts(client);
    return availableCourts[0] ?? null;
  }

  async countAvailableCourts(): Promise<number> {
    const availableCourts = await this.listAvailableCourts(prisma);
    return availableCourts.length;
  }

  private async listAvailableCourts(client: Prisma.TransactionClient | typeof prisma): Promise<Court[]> {
    const now = new Date();

    const activeCourts = await client.court.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      orderBy: { name: "asc" },
    });

    if (activeCourts.length === 0) {
      return [];
    }

    const courtIds = activeCourts.map((court) => court.id);

    const [maintenanceWindows, activeBookings, playingQueueEntries] = await Promise.all([
      client.courtMaintenance.findMany({
        // listAvailableCourts picks courts FOR open play, so an
        // OPEN_PLAY block — which exists precisely to free a court for
        // open play — must not remove it from the candidates. Third
        // consumer of this table to need the exclusion; MAINTENANCE and
        // SPECIAL_EVENT still remove a court, unchanged.
        where: {
          courtId: { in: courtIds },
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
          kind: { not: "OPEN_PLAY" },
        },
        select: { courtId: true, startAt: true, endAt: true },
      }),
      client.booking.findMany({
        where: { courtId: { in: courtIds }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
        select: { courtId: true, startAt: true, endAt: true },
      }),
      client.openPlayQueue.findMany({
        where: { courtId: { in: courtIds }, status: "PLAYING" },
        select: { courtId: true },
      }),
    ]);

    const busyCourtIds = new Set<string>();

    for (const window of maintenanceWindows) {
      if (hasTimeOverlap(now, now, window.startAt, window.endAt)) {
        busyCourtIds.add(window.courtId);
      }
    }

    for (const booking of activeBookings) {
      if (hasTimeOverlap(now, now, booking.startAt, booking.endAt)) {
        busyCourtIds.add(booking.courtId);
      }
    }

    for (const entry of playingQueueEntries) {
      if (entry.courtId) {
        busyCourtIds.add(entry.courtId);
      }
    }

    return activeCourts.filter((court) => !busyCourtIds.has(court.id));
  }
}

export const courtAssignmentService = new CourtAssignmentService();
