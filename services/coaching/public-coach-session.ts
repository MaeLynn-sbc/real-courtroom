import {
  publicAddCoachSchema,
  publicRemoveCoachSchema,
  type PublicAddCoachInput,
  type PublicRemoveCoachInput,
} from "@/features/coaching/schemas/public-coaching.schema";
import { coachSessionService, CoachSessionConflictError } from "@/services/coaching/coach-session.service";

export interface PublicAddCoachResult {
  error: string | null;
  coachSessionId?: string;
  // The actual rateCents charged (fresh from CoachRate at creation time,
  // see createCoachSession's own snapshot comment) — the client's amount-
  // due recompute uses this, not its own local guess at the selected
  // rate, so a stale client-side rate list can never under/overstate the
  // real GCash amount due.
  priceCents?: number;
}

export interface PublicRemoveCoachResult {
  error: string | null;
}

// Extracted from actions/public-coaching.actions.ts specifically so this
// can be called directly from an integration test without hitting
// revalidatePath's "static generation store missing" crash outside a
// real Next.js request — the same reason booking-status.ts/
// booking-reference.ts stay Prisma-adjacent-but-callable rather than
// living inline in an action.
//
// This IS the security boundary Gate 3 review is about, isolated from
// the request-level concerns (rate limiting, revalidation) that wrap it
// in the actual action: publicAddCoachSchema only defines bookingId/
// coachId/groupSize, so `.safeParse` strips any other keys — including
// source or isOutsideAvailability — from `parsed.data` before this
// function ever sees them. source is then hardcoded "PUBLIC" as a
// SEPARATE argument to createCoachSession, not read from the input
// object at all, and the object literal built for it below only ever
// carries the three named fields — there is no line of code here that
// could forward a client-supplied source or isOutsideAvailability even
// by accident.
export async function addPublicCoachToBooking(
  input: PublicAddCoachInput,
  actorUserId: string,
): Promise<PublicAddCoachResult> {
  const parsed = publicAddCoachSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    const coachSession = await coachSessionService.createCoachSession(
      {
        bookingId: parsed.data.bookingId,
        coachId: parsed.data.coachId,
        groupSize: parsed.data.groupSize,
      },
      "PUBLIC",
      actorUserId,
    );
    return { error: null, coachSessionId: coachSession.id, priceCents: coachSession.rateCents };
  } catch (error) {
    if (error instanceof CoachSessionConflictError) {
      return { error: error.message };
    }
    throw error;
  }
}

// Same split as addPublicCoachToBooking above: the payment-submitted
// guard and the actual cancellation live in coachSessionService.
// removeCoachSession, called with only bookingId — which coach session
// that resolves to is looked up server-side, never taken from the
// client (see publicRemoveCoachSchema's own comment).
export async function removePublicCoachFromBooking(
  input: PublicRemoveCoachInput,
  actorUserId: string,
): Promise<PublicRemoveCoachResult> {
  const parsed = publicRemoveCoachSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await coachSessionService.removeCoachSession(parsed.data.bookingId, actorUserId);
    return { error: null };
  } catch (error) {
    if (error instanceof CoachSessionConflictError) {
      return { error: error.message };
    }
    throw error;
  }
}
