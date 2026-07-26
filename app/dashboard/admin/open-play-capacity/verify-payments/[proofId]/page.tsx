import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OpenPlayPaymentVerificationDetail } from "@/features/open-play-capacity/components/open-play-payment-verification-detail";
import { openPlayRegistrationPaymentProofService } from "@/services/open-play/open-play-registration-payment-proof.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Verify Open Play Payment",
};

export const dynamic = "force-dynamic";

interface VerifyOpenPlayPaymentDetailPageProps {
  params: Promise<{ proofId: string }>;
}

export default async function VerifyOpenPlayPaymentDetailPage({ params }: VerifyOpenPlayPaymentDetailPageProps) {
  const { proofId } = await params;
  const [proof, openPlaySettings] = await Promise.all([
    openPlayRegistrationPaymentProofService.getProofById(proofId),
    settingsService.getOpenPlaySettings(),
  ]);

  if (!proof) {
    notFound();
  }

  return <OpenPlayPaymentVerificationDetail proof={proof} expectedAmountCents={openPlaySettings.friSatRegistrationFeeCents} />;
}
