"use server";

import { revalidatePath } from "next/cache";

import type { PublicAddCoachInput } from "@/features/coaching/schemas/public-coaching.schema";
import { toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { getWebsiteBookingContext } from "@/services/booking/website-identity";
import { addPublicCoachToBooking } from "@/services/coaching/public-coach-session";

export interface PublicAddCoachActionState {
  error: string | null;
  coachSessionId?: string;
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
