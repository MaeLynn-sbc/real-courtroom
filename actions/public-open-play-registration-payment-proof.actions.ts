"use server";

import { revalidatePath } from "next/cache";

import {
  submitOpenPlayRegistrationPaymentProofSchema,
  type SubmitOpenPlayRegistrationPaymentProofActionInput,
} from "@/features/open-play-capacity/schemas/public-open-play-registration-payment-proof.schema";
import { toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  openPlayRegistrationPaymentProofService,
  OpenPlayRegistrationNotAwaitingPaymentError,
} from "@/services/open-play/open-play-registration-payment-proof.service";

export interface SubmitOpenPlayRegistrationPaymentProofActionState {
  error: string | null;
  proofId?: string;
}

const RATE_LIMIT_MAX = 8;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// No session — the public, unauthenticated entry point, same shape as
// submitPublicBookingPaymentProofAction. Thin wrapper only: the actual
// hardening (hardcoded status, ignoring any resolution fields a crafted
// request sends) lives in
// openPlayRegistrationPaymentProofService.submitOpenPlayRegistrationPaymentProof
// itself, not here.
export async function submitPublicOpenPlayRegistrationPaymentProofAction(
  input: SubmitOpenPlayRegistrationPaymentProofActionInput,
): Promise<SubmitOpenPlayRegistrationPaymentProofActionState> {
  const parsed = submitOpenPlayRegistrationPaymentProofSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid payment proof." };
  }

  const rateLimit = checkRateLimit(
    `open-play-registration-payment-proof:${parsed.data.registrationId}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return { error: "Too many submission attempts — please wait a while and try again." };
  }

  try {
    const proof = await openPlayRegistrationPaymentProofService.submitOpenPlayRegistrationPaymentProof({
      registrationId: parsed.data.registrationId,
      gcashReference: parsed.data.gcashReference,
      submittedAmountCents: parsed.data.submittedAmountCents,
      screenshot: {
        fileName: parsed.data.screenshot.fileName,
        contentType: parsed.data.screenshot.contentType,
        data: Buffer.from(parsed.data.screenshot.dataBase64, "base64"),
      },
    });

    revalidatePath("/dashboard/admin/open-play-capacity");

    return { error: null, proofId: proof.id };
  } catch (error) {
    if (error instanceof OpenPlayRegistrationNotAwaitingPaymentError) {
      return { error: error.message };
    }
    return { error: toActionError(error, { action: "submitPublicOpenPlayRegistrationPaymentProofAction" }) };
  }
}
