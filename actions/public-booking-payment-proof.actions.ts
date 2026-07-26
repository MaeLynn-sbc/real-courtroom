"use server";

import { revalidatePath } from "next/cache";

import {
  submitBookingPaymentProofSchema,
  type SubmitBookingPaymentProofActionInput,
} from "@/features/bookings/schemas/booking-payment-proof.schema";
import { toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  bookingPaymentProofService,
  BookingNotAwaitingPaymentError,
  DuplicateGcashReferenceError,
} from "@/services/booking/booking-payment-proof.service";

export interface SubmitBookingPaymentProofActionState {
  error: string | null;
  proofId?: string;
}

const RATE_LIMIT_MAX = 8;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// No session — the public, unauthenticated confirmation-screen entry
// point (Booking Lookup / the hold's own confirmation page, once built).
// Thin wrapper: rate-limit + revalidation only. The actual hardening
// (hardcoded status, ignoring any resolution fields a crafted request
// sends) lives in bookingPaymentProofService.submitBookingPaymentProof
// itself, not here — see that method's doc comment.
export async function submitPublicBookingPaymentProofAction(
  input: SubmitBookingPaymentProofActionInput,
): Promise<SubmitBookingPaymentProofActionState> {
  const parsed = submitBookingPaymentProofSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid payment proof." };
  }

  const rateLimit = checkRateLimit(
    `booking-payment-proof:${parsed.data.bookingId}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return { error: "Too many submission attempts — please wait a while and try again." };
  }

  try {
    const proof = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: parsed.data.bookingId,
      gcashReference: parsed.data.gcashReference,
      submittedAmountCents: parsed.data.submittedAmountCents,
      screenshot: {
        fileName: parsed.data.screenshot.fileName,
        contentType: parsed.data.screenshot.contentType,
        data: Buffer.from(parsed.data.screenshot.dataBase64, "base64"),
      },
    });

    revalidatePath("/dashboard/bookings");
    revalidatePath(`/dashboard/bookings/${parsed.data.bookingId}`);
    revalidatePath("/dashboard/bookings/verify-payments");

    return { error: null, proofId: proof.id };
  } catch (error) {
    if (error instanceof BookingNotAwaitingPaymentError || error instanceof DuplicateGcashReferenceError) {
      return { error: error.message };
    }
    return { error: toActionError(error, { action: "submitPublicBookingPaymentProofAction" }) };
  }
}
