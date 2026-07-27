"use server";

import { revalidatePath } from "next/cache";

import {
  cancelPublicOpenPlayRegistrationSchema,
  type CancelPublicOpenPlayRegistrationInput,
} from "@/features/open-play-capacity/schemas/public-open-play-registration-cancellation.schema";
import { toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { openPlayRegistrationService } from "@/services/open-play/open-play-registration.service";

export interface CancelPublicOpenPlayRegistrationActionState {
  error: string | null;
}

const RATE_LIMIT_MAX = 8;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// No session — the public, customer-facing cancellation entry point
// (BUILD-SPEC.md's open-play "Cancellation policy" section). Rate-
// limited per registrationId, same shape and limits as
// submitPublicOpenPlayRegistrationPaymentProofAction, since this is the
// same kind of unauthenticated, phone-guessable-in-principle action.
// The actual phone verification and source==="WEBSITE" scoping live in
// openPlayRegistrationService.cancelRegistrationAsCustomer — this is a
// thin wrapper only.
export async function cancelPublicOpenPlayRegistrationAction(
  input: CancelPublicOpenPlayRegistrationInput,
): Promise<CancelPublicOpenPlayRegistrationActionState> {
  const parsed = cancelPublicOpenPlayRegistrationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const rateLimit = checkRateLimit(
    `open-play-registration-cancellation:${parsed.data.registrationId}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return { error: "Too many attempts — please wait a while and try again." };
  }

  try {
    await openPlayRegistrationService.cancelRegistrationAsCustomer(parsed.data.registrationId, parsed.data.phone);
    // Deliberately NOT revalidating /open-play/cancel — that's the SAME
    // page the customer is on. Revalidating it would re-run the lookup
    // server-side, find the registration no longer CONFIRMED, and
    // unmount this exact form (with its "cancelled" confirmation
    // message) before the customer ever sees it. The staff roster is
    // the one screen that actually needs fresh data after this.
    revalidatePath("/dashboard/admin/open-play-capacity");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "cancelPublicOpenPlayRegistrationAction" }) };
  }
}
