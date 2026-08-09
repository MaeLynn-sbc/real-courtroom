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
  | "NO_RATE_SET"
  | "PAYMENT_ALREADY_SUBMITTED";

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
    case "PAYMENT_ALREADY_SUBMITTED":
      return "Payment has already been submitted for this booking — contact us to add or remove a coach.";
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

  // Powers two things: the coach-availability editor's "booked" cell
  // state (features/coaching/components/coach-availability-manager.tsx)
  // and its "warn, don't block" clear-hour confirmation. Excludes
  // CANCELLED/NO_SHOW on the session itself, AND — reported live,
  // 2026-08-04, fixed alongside the "still shows available" calendar
  // bug — CANCELLED/NO_SHOW/REJECTED on the linked booking too, same
  // exclusion createCoachSession's own double-booking check and
  // listAvailableCoaches already use. Missing that second half meant a
  // coach session whose booking was REJECTED (GCash proof never
  // cleared, court slot released) still counted as "active" here,
  // which would have shown that hour as falsely booked once the
  // calendar started using this data to render a blocked state.
  async listActiveSessionsForCoach(coachId: string) {
    return prisma.coachSession.findMany({
      where: {
        coachId,
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        booking: { status: { notIn: ["CANCELLED", "NO_SHOW", "REJECTED"] } },
      },
      select: {
        id: true,
        sessionReference: true,
        guestName: true,
        player: { select: { user: { select: { name: true, email: true } } } },
        booking: { select: { startAt: true, endAt: true, court: { select: { name: true } } } },
      },
      orderBy: { booking: { startAt: "asc" } },
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
      // Race protection (public coach-add vs. a concurrent payment-proof
      // submission): an explicit row lock, not just this transaction's
      // own Serializable isolation. Proven live (services/coaching/
      // coach-session-payment-race.integration.ts): a plain SELECT here,
      // even under Serializable isolation, does NOT block a concurrent
      // UPDATE on the same row — confirmed directly against raw Postgres,
      // not assumed. submitBookingPaymentProof's transaction runs at the
      // default isolation level and simply proceeds, unblocked, while
      // this transaction is still mid-flight; without a lock, the proof
      // check below can read "no proof yet," a proof can then commit
      // underneath it, and this transaction still inserts the coach
      // session using its now-stale read — the exact "silently allowed"
      // outcome the guard exists to prevent. SELECT ... FOR UPDATE takes
      // a real row lock: submitBookingPaymentProof's own write to this
      // same Booking row (its WHERE-guarded updateMany) blocks until
      // this transaction commits or rolls back, so whichever of the two
      // reaches this row first is guaranteed to fully finish before the
      // other can proceed. Taken unconditionally (both STAFF and PUBLIC)
      // since locking has no observable effect beyond ordering — STAFF's
      // own behavior is otherwise completely unchanged.
      await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${input.bookingId} FOR UPDATE`;

      const booking = await tx.booking.findUnique({ where: { id: input.bookingId } });
      if (!booking) {
        throw new CoachSessionConflictError("BOOKING_NOT_FOUND");
      }

      // Ordering guard (public flow only): once a BookingPaymentProof row
      // exists for this booking, the customer has already committed to a
      // specific amount — attaching a coach after that point would
      // silently make what they sent wrong, with no way to reconcile it.
      // A proof-row check, not a status check, is what actually
      // distinguishes this from the always-safe "pay at venue" case: a
      // non-prepayment booking goes straight to CONFIRMED and never has a
      // proof row at all, so it's untouched by this guard. Staff (source
      // "STAFF") are never subject to this — they manage bookings
      // regardless of payment state. Safe to check now: the row lock
      // above guarantees this read sees any proof a concurrent submission
      // already committed, not a stale pre-submission snapshot.
      if (source === "PUBLIC") {
        const proofSubmitted = await tx.bookingPaymentProof.findFirst({ where: { bookingId: input.bookingId } });
        if (proofSubmitted) {
          throw new CoachSessionConflictError("PAYMENT_ALREADY_SUBMITTED");
        }
      }

      // bookingId is @unique on CoachSession — one row per booking, ever.
      // A CANCELLED row (removeCoachSession only ever cancels, never
      // deletes, to keep its full history) isn't a live conflict, but it
      // does mean the row below must be an UPDATE reactivating it, not a
      // fresh INSERT — a second create() with the same bookingId would
      // hit the unique constraint. Anything else existing (CONFIRMED,
      // etc.) is a real, live conflict.
      const existing = await tx.coachSession.findUnique({ where: { bookingId: input.bookingId } });
      if (existing && existing.status !== "CANCELLED") {
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
      //
      // Merge-time fix (Coaching x Phase 8): the parent booking filter
      // mirrors booking.service.ts's checkAvailabilityWithClient — REJECTED
      // is excluded (a GCash proof that never cleared; the court slot
      // released, so the coach's shouldn't stay blocked either). Missed
      // 2026-08-03 alongside two other copies in coach-availability.service.ts:
      // this used to ALSO exclude an AWAITING_PAYMENT hold past its
      // holdExpiresAt, on the theory that an unpaid hold shouldn't block
      // forever — reversed everywhere else that day (see
      // checkAvailabilityWithClient's own comment for the real incident
      // that drove it) but not here, so a coach could still be double-
      // booked onto a court a stale, unresolved hold was still genuinely
      // occupying. A stale hold now blocks its coach the same way it
      // blocks its court — only an explicit staff cancellation releases
      // either.
      const now = new Date();
      const activeSessions = await tx.coachSession.findMany({
        where: {
          coachId: input.coachId,
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
          booking: {
            status: { notIn: ["CANCELLED", "NO_SHOW", "REJECTED"] },
          },
        },
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

      const sequence = await nextSequence(dailyScope("COACH_SESSION", now), tx);
      const sessionReference = formatCoachSessionReference(now, sequence);

      // Customer identity is read through the parent booking, not
      // re-entered — one source of truth for "who," same reasoning as
      // "when" living on the booking (Gate 1 review).
      const sharedData = {
        sessionReference,
        coachId: input.coachId,
        bookedById: booking.bookedById,
        playerId: booking.playerId,
        groupSize: input.groupSize,
        rateCents: rate.priceCents,
        status: "CONFIRMED" as const,
        source,
        isOutsideAvailability,
        guestName: booking.guestName,
        guestPhone: booking.guestPhone,
        guestEmail: booking.guestEmail,
        cancelledAt: null,
      };
      const coachSession = existing
        ? await tx.coachSession.update({ where: { id: existing.id }, data: sharedData })
        : await tx.coachSession.create({ data: { bookingId: input.bookingId, ...sharedData } });

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

  // The public flow's own "remove" — only ever called from that path (see
  // public-coach-session.ts), so unlike createCoachSession this applies
  // the payment-submitted guard unconditionally rather than gating it on
  // a source argument. Same signal as the add-side guard: a booking with
  // any BookingPaymentProof row is off-limits, since removing a coach the
  // customer already paid for would make the amount they sent wrong in
  // the other direction. No-op (not an error) if there's nothing to
  // remove — the caller can't distinguish "already removed" from "never
  // added" and shouldn't need to.
  async removeCoachSession(bookingId: string, actorUserId: string): Promise<void> {
    const proofSubmitted = await prisma.bookingPaymentProof.findFirst({ where: { bookingId } });
    if (proofSubmitted) {
      throw new CoachSessionConflictError("PAYMENT_ALREADY_SUBMITTED");
    }

    const session = await prisma.coachSession.findUnique({ where: { bookingId } });
    if (!session || session.status === "CANCELLED") {
      return;
    }

    await this.cancelCoachSession(session.id, actorUserId);
  }
}

export const coachSessionService = new CoachSessionService();
