"use client";

import Image from "next/image";
import { useState, useTransition } from "react";

import { submitPublicOpenPlayRegistrationPaymentProofAction } from "@/actions/public-open-play-registration-payment-proof.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContactFallbackLinks } from "@/features/bookings/components/contact-fallback-links";
import type { GcashPaymentInfo } from "@/features/cms/schemas/cms.schema";
import { formatCurrency } from "@/lib/utils";

interface OpenPlayRegistrationProofFormProps {
  registrationId: string;
  expectedAmountCents: number;
  // Reported live: this screen never showed the QR code, account name,
  // or account number — a customer registering from home had no way to
  // know where to send the money. Same settingsService.getGcashPaymentInfo()
  // the court booking flow already uses (features/bookings/components/
  // public-payment-proof-upload.tsx), threaded down from the page — not
  // a second, hardcoded copy.
  gcashInfo: GcashPaymentInfo;
  contactPhone: string;
  contactFacebookUrl: string;
  onSubmitted: () => void;
}

// Mirrors features/bookings/components/record-gcash-payment-form.tsx's
// file -> base64 -> action shape exactly. Unlike that component (staff-
// only today — the public upload step for court bookings is still "not
// yet built," confirmed while researching this), this one IS the
// public, self-service step — reachable by anyone who just registered,
// no staff session involved. Same action-side hardening either way.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function OpenPlayRegistrationProofForm({
  registrationId,
  expectedAmountCents,
  gcashInfo,
  contactPhone,
  contactFacebookUrl,
  onSubmitted,
}: OpenPlayRegistrationProofFormProps) {
  const [gcashReference, setGcashReference] = useState("");
  const [submittedAmount, setSubmittedAmount] = useState(String(expectedAmountCents / 100));
  const [file, setFile] = useState<File | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    if (!gcashReference.trim() || !file) {
      setServerError("Enter the GCash reference and attach a screenshot.");
      return;
    }
    const amountCents = Math.round(Number(submittedAmount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setServerError("Enter a valid amount.");
      return;
    }

    startTransition(async () => {
      const dataBase64 = await fileToBase64(file);
      const result = await submitPublicOpenPlayRegistrationPaymentProofAction({
        registrationId,
        gcashReference: gcashReference.trim(),
        submittedAmountCents: amountCents,
        screenshot: { fileName: file.name, contentType: file.type || "image/png", dataBase64 },
      });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      onSubmitted();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium">Pay via GCash</p>
        <p className="text-muted-foreground text-xs">
          Send {formatCurrency(expectedAmountCents)} to the account below, then upload your payment screenshot to
          confirm your spot.
        </p>
      </div>

      {gcashInfo.qrImageUrl ? (
        <Image
          src={gcashInfo.qrImageUrl}
          alt="GCash QR code"
          width={160}
          height={160}
          unoptimized
          className="self-center rounded-lg border"
        />
      ) : null}

      {gcashInfo.accountName || gcashInfo.accountNumber ? (
        <div className="rounded-lg border p-3 text-sm">
          {gcashInfo.accountName ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Account name</span>
              <span className="font-medium">{gcashInfo.accountName}</span>
            </div>
          ) : null}
          {gcashInfo.accountNumber ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Account number</span>
              <span className="font-mono font-medium">{gcashInfo.accountNumber}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="proofGcashReference">GCash reference number</Label>
          <Input
            id="proofGcashReference"
            value={gcashReference}
            onChange={(event) => setGcashReference(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="proofSubmittedAmount">Amount sent (₱)</Label>
          <Input
            id="proofSubmittedAmount"
            type="number"
            step="0.01"
            value={submittedAmount}
            onChange={(event) => setSubmittedAmount(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="proofScreenshot">Screenshot</Label>
          <Input
            id="proofScreenshot"
            type="file"
            accept="image/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
        {serverError ? (
          <p className="text-destructive text-sm" role="alert">
            {serverError}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={isPending}>
          {isPending ? "Submitting…" : "Submit payment"}
        </Button>
      </form>

      {contactPhone || contactFacebookUrl ? (
        <p className="text-muted-foreground text-xs">
          Wrong file, or haven&apos;t heard back?{" "}
          <ContactFallbackLinks phone={contactPhone} facebookUrl={contactFacebookUrl} />.
        </p>
      ) : null}
    </div>
  );
}
