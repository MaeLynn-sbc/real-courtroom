"use server";

import { revalidatePath } from "next/cache";

import type { PublicAddCoachInput, PublicRemoveCoachInput } from "@/features/coaching/schemas/public-coaching.schema";
import { toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { getWebsiteBookingContext } from "@/services/booking/website-identity";
import { addPublicCoachToBooking, removePublicCoachFromBooking } from "@/services/coaching/public-coach-session";

export interface PublicAddCoachActionState {
  error: string | null;
  coachSessionId?: string;
  priceCents?: number;
}

export interface PublicRemoveCoachActionState {
  error: string | null;
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// The public, unauthenticated add-a-coach step — same website system
// identity createPublicBookingAction resolves for actorUserId, no
// session required. The actual source-hardcoding / isOutsideAvailability-
// stripping guarantee lives in services/coaching/public-coach-session.ts
// (addPublicCoachToBooking) — extracted there so it's directly callable
// from an integration test, not just reachable through this action.
export async function addPublicCoachToBookingAction(
  input: PublicAddCoachInput,
): Promise<PublicAddCoachActionState> {
  const rateLimit = checkRateLimit(`public-add-coach:${input.bookingId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return { error: "Too many attempts — please wait a while and try again." };
  }

  try {
    const context = await getWebsiteBookingContext();
    const result = await addPublicCoachToBooking(input, context.userId);

    if (!result.error) {
      revalidatePath("/dashboard/bookings");
      revalidatePath(`/dashboard/bookings/${input.bookingId}`);
      revalidatePath("/dashboard/coaching");
    }

    return result;
  } catch (error) {
    return { error: toActionError(error, { action: "addPublicCoachToBookingAction" }) };
  }
}

// The public, unauthenticated remove-a-coach step, only reachable while
// no payment proof has been submitted yet — see
// services/coaching/coach-session.service.ts's removeCoachSession for the
// enforcement. Rate-limited under its own key so an add/remove flurry on
// one booking can't exhaust the add limit.
export async function removePublicCoachFromBookingAction(
  input: PublicRemoveCoachInput,
): Promise<PublicRemoveCoachActionState> {
  const rateLimit = checkRateLimit(`public-remove-coach:${input.bookingId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return { error: "Too many attempts — please wait a while and try again." };
  }

  try {
    const context = await getWebsiteBookingContext();
    const result = await removePublicCoachFromBooking(input, context.userId);

    if (!result.error) {
      revalidatePath("/dashboard/bookings");
      revalidatePath(`/dashboard/bookings/${input.bookingId}`);
      revalidatePath("/dashboard/coaching");
    }

    return result;
  } catch (error) {
    return { error: toActionError(error, { action: "removePublicCoachFromBookingAction" }) };
  }
}
