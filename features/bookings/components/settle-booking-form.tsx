"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { settleBookingAction } from "@/actions/booking.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  deriveSettlementMethod,
  SettlementPaymentFields,
} from "@/components/shared/settlement-payment-fields";
import { formatCurrency } from "@/lib/utils";
import type { SettlementPaymentMethodOption } from "@/lib/settlement-payment-methods";

interface SettleBookingFormProps {
  bookingId: string;
  amountCents: number;
  paymentMethods: SettlementPaymentMethodOption[];
}

// Mirrors PublicPaymentProofUpload's own fileToBase64 — same established
// per-file duplicated pattern this codebase already uses rather than a
// shared cross-module helper.
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

export function SettleBookingForm({
  bookingId,
  amountCents,
  paymentMethods,
}: SettleBookingFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [gcashReference, setGcashReference] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  function handleSettle() {
    setServerError(null);
    const method = deriveSettlementMethod(paymentMethods, paymentMethodId);
    if (!method) {
      setServerError("Select a payment method.");
      return;
    }
    if (method === "GCASH" && !gcashReference.trim()) {
      setServerError("Enter a GCash reference number.");
      return;
    }

    startTransition(async () => {
      const receipt = receiptFile
        ? {
            fileName: receiptFile.name,
            contentType: receiptFile.type || "application/octet-stream",
            dataBase64: await fileToBase64(receiptFile),
          }
        : undefined;

      const result = await settleBookingAction({
        bookingId,
        method,
        gcashReference: method === "GCASH" ? gcashReference.trim() : undefined,
        paymentMethodId,
        receipt,
      });
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Payment recorded.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Settle bill</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Confirmed. {formatCurrency(amountCents)} to collect at the venue.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <SettlementPaymentFields
            paymentMethods={paymentMethods}
            paymentMethodId={paymentMethodId}
            onPaymentMethodIdChange={setPaymentMethodId}
            gcashReference={gcashReference}
            onGcashReferenceChange={setGcashReference}
            idPrefix="settleBookingPaymentMethod"
          />
          <Button type="button" disabled={isPending} onClick={handleSettle}>
            Confirm {formatCurrency(amountCents)} settled
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="settleBookingReceipt" className="text-muted-foreground text-xs">
            Receipt / proof of payment (optional)
          </label>
          <input
            id="settleBookingReceipt"
            type="file"
            accept="image/*"
            onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
            className="text-muted-foreground text-xs"
          />
        </div>
        {serverError ? (
          <p className="text-destructive text-sm" role="alert">
            {serverError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
