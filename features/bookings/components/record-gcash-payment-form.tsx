"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { submitPublicBookingPaymentProofAction } from "@/actions/public-booking-payment-proof.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RecordGcashPaymentFormProps {
  bookingId: string;
  expectedAmountCents: number;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:image/png;base64," prefix — the action only wants
      // the raw base64 payload.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// A hold waits on the CUSTOMER to submit this — this form exists for the
// case a customer calls in or comes to the desk with their GCash
// confirmation instead of using the (not-yet-built) online upload step.
// Reuses submitPublicBookingPaymentProofAction as-is: that action has no
// session requirement by design (BUILD-SPEC.md §8's public path), so a
// staff member using it here is no different from the customer using it
// themselves — same hardening, same hardcoded status=PENDING.
export function RecordGcashPaymentForm({ bookingId, expectedAmountCents }: RecordGcashPaymentFormProps) {
  const router = useRouter();
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
      const result = await submitPublicBookingPaymentProofAction({
        bookingId,
        gcashReference: gcashReference.trim(),
        submittedAmountCents: amountCents,
        screenshot: { fileName: file.name, contentType: file.type || "image/png", dataBase64 },
      });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Payment submitted — waiting on verification.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record GCash payment</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gcashReference">GCash reference number</Label>
            <Input
              id="gcashReference"
              value={gcashReference}
              onChange={(event) => setGcashReference(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="submittedAmount">Amount sent (₱)</Label>
            <Input
              id="submittedAmount"
              type="number"
              step="0.01"
              value={submittedAmount}
              onChange={(event) => setSubmittedAmount(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="screenshot">Screenshot</Label>
            <Input
              id="screenshot"
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
          <Button type="submit" size="sm" disabled={isPending} className="self-start">
            {isPending ? "Submitting…" : "Submit payment"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
