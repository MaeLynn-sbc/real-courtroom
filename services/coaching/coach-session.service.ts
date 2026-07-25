import type { CreateCoachSessionInput } from "@/features/coaching/schemas/coaching.schema";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { CoachSessionSource } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
import { runSerializableWithRetry } from "@/lib/serializable-retry";
import { hasTimeOverlap } from "@/services/booking/booking-availability";
import { isSlotFullyCovered } from "@/services/coaching/coach-availability-match";
import { formatCoachSessionReference } from "@/services/coaching/coach-session-reference";

export type CoachSessionConflictType =
  | "BOOKING_NOT_FOUND"
  | "ALREADY_HAS_COACH_SESSION"
  | "NOT_A_COACH"
  | "OUTSIDE_AVAILABILITY"
  | "COACH_DOUBLE_BOOKED"
  | "NO_RATE_SET";

function describeConflict(type: CoachSessionConflictType): string {
  switch (type) {
    case "BOOKING_NOT_FOUND":
      return "That booking no longer exists.";
    case "ALREADY_HAS_COACH_SESSION":
      return "This booking already has a coach attached.";
    case "NOT_A_COACH":
      return "This employee isn't marked as a coach.";
    case "OUTSIDE_AVAILABILITY":
      return "This coach isn't available for the selected time.";
    case "COACH_DOUBLE_BOOKED":
      return "This coach is already booked for an overlapping time.";
    case "NO_RATE_SET":
      return "No rate is set for this coach at this group size.";
  }
}

export class CoachSessionConflictError extends Error {
  readonly type: CoachSessionConflictType;

  constructor(type: CoachSessionConflictType) {
    super(describeConflict(type));
    this.name = "CoachSessionConflictError";
    this.type = type;
  }
}

const coachSessionWithRelations = {
  booking: true,
  coach: { include: { user: { select: { id: true, name: true, email: true } } } },
  bookedBy: { select: { id: true, name: true, email: true } },
  player: { include: { user: { select: { id: true, name: true, email: true } } } },
} satisfies Prisma.CoachSessionInclude;

export class CoachSessionService {
  async getById(coachSessionId: string) {
    return prisma.coachSession.findUnique({
      where: { id: coachSessionId },
      include: coachSessionWithRelations,
    });
  }

  async getByBookingId(bookingId: string) {
    return prisma.coachSession.findUnique({
      where: { bookingId },
      include: coachSessionWithRelations,
    });
  }

  async listSessions() {
    return prisma.coachSession.findMany({
      include: coachSessionWithRelations,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  // The one creation path both the (not-yet-built) public flow and the
  // staff desk flow will call — source distinguishes them, set by the
  // caller (action layer), never inferred here. Mirrors
  // booking.service.ts's createBooking shape closely: one Serializable
  // transaction covers the availability check, the coach-double-booking
  // check, and the insert together, so two concurrent requests can't
  // both read "available" before either writes.
  async createCoachSession(input: CreateCoachSessionInput, source: CoachSessionSource, actorUserId: string) {
    return runSerializableWithRetry(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: input.bookingId } });
      if (!booking) {
        throw new CoachSessionConflictError("BOOKING_NOT_FOUND");
      }

      const existing = await tx.coachSession.findUnique({ where: { bookingId: input.bookingId } });
      if (existing) {
        throw new CoachSessionConflictError("ALREADY_HAS_COACH_SESSION");
      }

      const coach = await tx.employee.findUnique({ where: { id: input.coachId } });
      if (!coach || !coach.isCoach || !coach.isActive) {
        throw new CoachSessionConflictError("NOT_A_COACH");
      }

      // Availability: staff may bypass with isOutsideAvailability, same
      // shape as Booking.isAfterHours — public can never set this flag
      // (createCoachSessionSchema doesn't expose it to that path; the
      // action layer for the public route never passes it through).
      const staffOverride = source === "STAFF" && Boolean(input.isOutsideAvailability);
      let isOutsideAvailability = false;
      if (!staffOverride) {
        const windows = await tx.coachAvailabilityWindow.findMany({ where: { coachId: input.coachId } });
        const covered = windows.some((window) =>
          isSlotFullyCovered(booking.startAt, booking.endAt, window.startAt, window.endAt),
        );
        if (!covered) {
          if (source === "PUBLIC") {
            throw new CoachSessionConflictError("OUTSIDE_AVAILABILITY");
          }
          // Staff didn't set the override but isn't covered either —
          // block rather than silently treat it as an override.
          throw new CoachSessionConflictError("OUTSIDE_AVAILABILITY");
        }
      } else {
        isOutsideAvailability = true;
      }

      // Concurrency guard: the resource being protected is the coach's
      // time, not the court's (the court booking's own concurrency guard
      // already ran when the booking itself was created). Two different
      // court bookings at the same slot, both attaching the same coach,
      // is the exact collision this check exists for.
      const activeSessions = await tx.coachSession.findMany({
        where: { coachId: input.coachId, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
        include: { booking: { select: { startAt: true, endAt: true } } },
      });
      const conflict = activeSessions.find((session) =>
        hasTimeOverlap(booking.startAt, booking.endAt, session.booking.startAt, session.booking.endAt),
      );
      if (conflict) {
        throw new CoachSessionConflictError("COACH_DOUBLE_BOOKED");
      }

      const rate = await tx.coachRate.findUnique({
        where: { coachId_groupSize: { coachId: input.coachId, groupSize: input.groupSize } },
      });
      if (!rate) {
        throw new CoachSessionConflictError("NO_RATE_SET");
      }

      const now = new Date();
      const sequence = await nextSequence(dailyScope("COACH_SESSION", now), tx);
      const sessionReference = formatCoachSessionReference(now, sequence);

      // Customer identity is read through the parent booking, not
      // re-entered — one source of truth for "who," same reasoning as
      // "when" living on the booking (Gate 1 review).
      const coachSession = await tx.coachSession.create({
        data: {
          sessionReference,
          bookingId: input.bookingId,
          coachId: input.coachId,
          bookedById: booking.bookedById,
          playerId: booking.playerId,
          groupSize: input.groupSize,
          rateCents: rate.priceCents,
          status: "CONFIRMED",
          source,
          isOutsideAvailability,
          guestName: booking.guestName,
          guestPhone: booking.guestPhone,
          guestEmail: booking.guestEmail,
        },
      });

      await tx.coachSessionHistory.create({
        data: { coachSessionId: coachSession.id, status: "CONFIRMED", changedById: actorUserId },
      });

      return coachSession;
    });
  }

  async cancelCoachSession(coachSessionId: string, actorUserId: string, note?: string) {
    const coachSession = await prisma.coachSession.update({
      where: { id: coachSessionId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    await prisma.coachSessionHistory.create({
      data: { coachSessionId, status: "CANCELLED", changedById: actorUserId, note },
    });

    return coachSession;
  }
}

export const coachSessionService = new CoachSessionService();
