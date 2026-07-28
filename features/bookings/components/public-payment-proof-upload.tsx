"use client";

import Image from "next/image";
import { useEffect, useState, useTransition } from "react";

import { submitPublicBookingPaymentProofAction } from "@/actions/public-booking-payment-proof.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GcashPaymentInfo } from "@/features/cms/schemas/cms.schema";
import { formatCurrency } from "@/lib/utils";

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

interface PublicPaymentProofUploadProps {
  bookingId: string;
  bookingReference: string;
  amountDueCents: number;
  guestPhone: string;
  gcashInfo: GcashPaymentInfo;
  // Fires once, right after a successful submission — lets the parent
  // lock the coach add-on (see public-booking-form.tsx): once proof is
  // submitted, the amount is committed and can no longer safely change.
  onSubmitted?: () => void;
}

// The customer-facing half of submitPublicBookingPaymentProofAction —
// that action was already built and hardened (rate-limited, no session,
// server hardcodes status=PENDING) but had no UI reachable from the
// public confirmation screen until now; the only existing caller was
// RecordGcashPaymentForm, a staff-facing form for a customer who calls
// in or visits the desk instead of paying online.
export function PublicPaymentProofUpload({
  bookingId,
  bookingReference,
  amountDueCents,
  guestPhone,
  gcashInfo,
  onSubmitted,
}: PublicPaymentProofUploadProps) {
  const [gcashReference, setGcashReference] = useState("");
  const [submittedAmount, setSubmittedAmount] = useState(String(amountDueCents / 100));
  // amountDueCents can change after mount now (adding/removing a coach
  // recomputes it in the parent) — resync the pre-fill to match, but only
  // until the customer actually edits the field by hand. Without the
  // guard, a customer who'd already typed a corrected amount would have
  // it silently overwritten the moment they added a coach.
  const [hasEditedAmount, setHasEditedAmount] = useState(false);
  useEffect(() => {
    if (!hasEditedAmount) {
      setSubmittedAmount(String(amountDueCents / 100));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountDueCents]);
  const [file, setFile] = useState<File | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Set once, at the moment of a successful submission — kept separate
  // from `file` (which stays tied to the now-hidden form input) so the
  // confirmation state below can still show which file went through.
  const [submittedFileName, setSubmittedFileName] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    // Reference is optional as long as a screenshot is attached — the
    // screenshot is the actual proof; the reference just helps staff
    // find the transaction faster.
    if (!file) {
      setServerError("Attach a screenshot of your payment confirmation.");
      return;
    }
    const amountCents = Math.round(Number(submittedAmount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setServerError("Enter a valid amount.");
      return;
    }

    startTransition(async () => {
      const dataBase64 = await fileToBase64(file);
      const result = await submitPublicBookingPaymentProofAction({
        bookingId,
        gcashReference: gcashReference.trim() || null,
        submittedAmountCents: amountCents,
        screenshot: { fileName: file.name, contentType: file.type || "image/png", dataBase64 },
      });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      setSubmittedFileName(file.name);
      onSubmitted?.();
    });
  }

  if (submittedFileName) {
    return (
      <div className="flex flex-col gap-3">
        <div className="border-success/40 bg-success/10 rounded-lg border p-4 text-sm">
          <p className="font-medium">Payment proof received.</p>
          <p className="text-muted-foreground mt-1">
            Our staff will verify your payment shortly. You&apos;ll receive a confirmation message
            at <span className="text-foreground font-medium">{guestPhone}</span> once your booking
            is confirmed.
          </p>
          <div className="border-border mt-2 flex flex-col gap-1 border-t pt-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reference</span>
              <span className="font-mono font-medium">{bookingReference}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">File uploaded</span>
              <span className="font-medium">{submittedFileName}</span>
            </div>
          </div>
        </div>
        <p className="text-warning-foreground bg-warning/15 rounded-lg p-2 text-xs font-medium">
          Your slot is still held, not confirmed yet — please wait for the confirmation message
          before coming in.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 border-t pt-3">
      <div>
        <p className="text-sm font-medium">Pay via GCash</p>
        <p className="text-muted-foreground text-xs">
          Send {formatCurrency(amountDueCents)} to the account below, then upload your payment
          screenshot to confirm this slot.
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

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="publicGcashReference">GCash reference number (optional)</Label>
          <Input
            id="publicGcashReference"
            placeholder="Leave blank if you're not sure"
            value={gcashReference}
            onChange={(event) => setGcashReference(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="publicSubmittedAmount">Amount sent (₱)</Label>
          <Input
            id="publicSubmittedAmount"
            type="number"
            step="0.01"
            value={submittedAmount}
            onChange={(event) => {
              setHasEditedAmount(true);
              setSubmittedAmount(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="publicScreenshot">Payment screenshot</Label>
          {/* The native file input's own trailing text ("No file
              chosen") isn't a DOM node — it's rendered by the browser
              and can't be restyled or reworded via CSS. Hidden here and
              replaced with a custom label (acting as the clickable
              button) plus a plain-text status span this component
              fully controls. */}
          <div className="flex items-center gap-3">
            <label
              htmlFor="publicScreenshot"
              className="cursor-pointer rounded-lg bg-blue-100 px-3 py-1.5 text-sm font-medium text-blue-900 transition-colors hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900"
            >
              Choose file
            </label>
            <span className="text-muted-foreground truncate text-sm">
              {file ? file.name : "Upload proof of payment"}
            </span>
          </div>
          <input
            id="publicScreenshot"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
        {serverError ? (
          <p className="text-destructive text-sm" role="alert">
            {serverError}
          </p>
        ) : null}
        <Button type="submit" disabled={isPending} className="self-start">
          {isPending ? "Submitting…" : "Submit payment"}
        </Button>
      </form>
    </div>
  );
}
