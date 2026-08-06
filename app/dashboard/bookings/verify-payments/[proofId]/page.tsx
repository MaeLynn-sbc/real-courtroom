import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PaymentVerificationDetail } from "@/features/bookings/components/payment-verification-detail";
import { bookingPaymentProofService } from "@/services/booking/booking-payment-proof.service";
import { bookingService } from "@/services/booking/booking.service";

export const metadata: Metadata = {
  title: "Verify Payment",
};

export const dynamic = "force-dynamic";

interface VerifyPaymentDetailPageProps {
  params: Promise<{ proofId: string }>;
}

export default async function VerifyPaymentDetailPage({ params }: VerifyPaymentDetailPageProps) {
  const { proofId } = await params;
  const proof = await bookingPaymentProofService.getProofById(proofId);

  if (!proof) {
    notFound();
  }

  // Cheap even when there's nothing to find — only a real mismatch
  // approval ever writes this audit row (see getApprovalOverrideReason's
  // own comment).
  const approvalOverrideReason = await bookingPaymentProofService.getApprovalOverrideReason(proofId);
  // Advisory duplicate-guest warning (2026-08-06 incident) — same
  // overlap check the approval transaction re-runs server-side; run here
  // too so staff see the warning BEFORE they click Approve, not just get
  // rejected after the fact.
  const duplicateBooking =
    proof.status === "PENDING"
      ? await bookingService.findOverlappingBookingForGuest(
          proof.booking.id,
          proof.booking.guestName,
          proof.booking.guestPhone,
          proof.booking.startAt,
          proof.booking.endAt,
        )
      : null;
  const duplicateOverrideReason = await bookingPaymentProofService.getDuplicateOverrideReason(proofId);

  return (
    <PaymentVerificationDetail
      proof={proof}
      approvalOverrideReason={approvalOverrideReason}
      duplicateBooking={duplicateBooking}
      duplicateOverrideReason={duplicateOverrideReason}
    />
  );
}
