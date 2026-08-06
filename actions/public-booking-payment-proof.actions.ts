"use server";

import { revalidatePath } from "next/cache";

import {
  submitBookingPaymentProofSchema,
  type SubmitBookingPaymentProofActionInput,
} from "@/features/bookings/schemas/booking-payment-proof.schema";
import { toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { bookingService } from "@/services/booking/booking.service";
import {
  bookingPaymentProofService,
  BookingNotAwaitingPaymentError,
  DuplicateGcashReferenceError,
} from "@/services/booking/booking-payment-proof.service";
import { getWebsiteBookingContext } from "@/services/booking/website-identity";

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

export interface CancelUnpaidPublicBookingActionState {
  error: string | null;
}

// Owner request (2026-08-06): "the booking shouldn't push through if no
// proof of payment is received" — a customer whose screenshot upload
// fails at Book Now time (network hiccup, or the body-size-limit
// incident this same day) used to keep an AWAITING_PAYMENT hold anyway,
// blocking the court indefinitely with no payment ever actually
// received. public-booking-form.tsx now calls this immediately when the
// initial screenshot-attached submission fails, instead of falling back
// to a separate "upload later" step — the hold is cancelled right away,
// same court-release/coach-cascade behavior updateBookingStatus already
// gives every other CANCELLED transition, and the customer sees a clear
// "this didn't go through, try again" state instead of a confirmation
// for a booking that silently isn't really confirmed.
//
// Same trust model as submitPublicBookingPaymentProofAction above — no
// session, bookingId alone is the authority (a CUID, not guessable) —
// and the same backstop: updateBookingStatus's own transition table only
// allows AWAITING_PAYMENT -> CANCELLED, so this can never touch a
// booking that's already moved past that state, regardless of what a
// crafted request sends.
export async function cancelUnpaidPublicBookingAction(
  bookingId: string,
): Promise<CancelUnpaidPublicBookingActionState> {
  if (!bookingId) {
    return { error: "Missing booking id." };
  }

  const rateLimit = checkRateLimit(`cancel-unpaid-public-booking:${bookingId}`, 8, 60 * 60 * 1000);
  if (!rateLimit.allowed) {
    return { error: "Too many attempts — please wait a while and try again." };
  }

  try {
    const context = await getWebsiteBookingContext();
    await bookingService.updateBookingStatus(
      bookingId,
      "CANCELLED",
      context.userId,
      "Payment screenshot could not be processed — booking automatically cancelled, slot released.",
    );
    revalidatePath("/dashboard/bookings");
    revalidatePath("/availability");
    return { error: null };
  } catch (error) {
    // Best-effort — the customer already sees the real error from the
    // proof-submission attempt itself; a failure here (e.g. the booking
    // already moved on for some other reason) shouldn't surface a second,
    // more confusing error on top of that.
    return { error: toActionError(error, { action: "cancelUnpaidPublicBookingAction" }) };
  }
}
