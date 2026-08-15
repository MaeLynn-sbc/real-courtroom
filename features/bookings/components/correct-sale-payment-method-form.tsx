"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { correctSalePaymentMethodAction } from "@/actions/sale.actions";
import { Button } from "@/components/ui/button";
import type { SettlementPaymentMethodOption } from "@/lib/settlement-payment-methods";

interface CorrectSalePaymentMethodFormProps {
  saleId: string;
  currentPaymentMethodId: string;
  currentPaymentMethodLabel: string;
  // Cash/GCash only — same allowlist toSettlementPaymentMethodOptions
  // already applies for a real settlement, since that's genuinely all a
  // guest can ever hand over at the venue.
  paymentMethods: SettlementPaymentMethodOption[];
}

// Owner report (2026-08-15): "can u dig dipper in the account
// reconciliation... they always have a large variance" — root cause: a
// website booking created under "Pay at Venue" gets a real Sale
// immediately, but once the guest actually pays cash or GCash at the
// venue there was no way to reflect that — the money is physically
// there but permanently invisible to cash/GCash reconciliation. The
// backend fix (saleService.correctPaymentMethod, owner request
// 2026-08-08 for a Cash⇄GCash miskey) already existed but was never
// wired into any screen. This is that missing screen — also doubles as
// the miskey-correction UI that request originally asked for, since
// it's the exact same underlying action for either case.
export function CorrectSalePaymentMethodForm({
  saleId,
  currentPaymentMethodId,
  currentPaymentMethodLabel,
  paymentMethods,
}: CorrectSalePaymentMethodFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [toPaymentMethodId, setToPaymentMethodId] = useState("");
  const [reason, setReason] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  const options = paymentMethods.filter((method) => method.id !== currentPaymentMethodId);

  if (!isOpen) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setIsOpen(true)}>
        Correct payment method
      </Button>
    );
  }

  function handleSubmit() {
    setServerError(null);
    if (!toPaymentMethodId) {
      setServerError("Select the payment method the guest actually used.");
      return;
    }
    if (!reason.trim()) {
      setServerError("Enter a reason for this correction.");
      return;
    }

    startTransition(async () => {
      const result = await correctSalePaymentMethodAction({
        saleId,
        fromPaymentMethodId: currentPaymentMethodId,
        toPaymentMethodId,
        reason: reason.trim(),
      });
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Payment method corrected.");
      router.refresh();
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-muted-foreground text-xs">
        Currently recorded as {currentPaymentMethodLabel} — correct this to the payment method the
        guest actually used.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
          value={toPaymentMethodId}
          onChange={(event) => setToPaymentMethodId(event.target.value)}
        >
          <option value="">Actually paid via…</option>
          {options.map((method) => (
            <option key={method.id} value={method.id}>
              {method.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Reason (e.g. paid cash at check-in)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="border-input h-9 min-w-48 flex-1 rounded-md border bg-transparent px-3 text-sm"
        />
        <Button type="button" size="sm" disabled={isPending} onClick={handleSubmit}>
          Save correction
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => setIsOpen(false)}
        >
          Cancel
        </Button>
      </div>
      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}
    </div>
  );
}
