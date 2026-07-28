import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PaymentVerificationDetail } from "@/features/bookings/components/payment-verification-detail";
import { bookingPaymentProofService } from "@/services/booking/booking-payment-proof.service";

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

  return <PaymentVerificationDetail proof={proof} approvalOverrideReason={approvalOverrideReason} />;
}
