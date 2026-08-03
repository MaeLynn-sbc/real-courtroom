"use server";

import { requireSession } from "@/lib/action-auth";
import { bookingPaymentProofService } from "@/services/booking/booking-payment-proof.service";
import { bookingService } from "@/services/booking/booking.service";

// Backs the verification banner's client-side polling
// (features/dashboard/components/verification-banner.tsx) — same
// unconditional-once-signed-in access as the existing header badge
// this banner sits alongside (app/dashboard/layout.tsx fetches
// countPendingProofs() for every dashboard session, no permission
// check beyond being signed in at all).
export async function getPendingPaymentVerificationCountAction(): Promise<number> {
  const authz = await requireSession();
  if (!authz.ok) {
    return 0;
  }

  return bookingPaymentProofService.countPendingProofs();
}

// Backs the stale-holds banner's client-side polling
// (features/dashboard/components/stale-holds-banner.tsx), same shape and
// same unconditional-once-signed-in access as the payment-verification
// count above.
export async function getStaleHoldsCountAction(): Promise<number> {
  const authz = await requireSession();
  if (!authz.ok) {
    return 0;
  }

  return bookingService.countStaleHolds();
}
