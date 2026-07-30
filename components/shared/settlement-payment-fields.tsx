"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SettlementPaymentMethodOption } from "@/lib/settlement-payment-methods";

// Was two dropdowns — "Paid via" (CASH/GCASH) and "Payment method" (which
// configured PaymentMethod row) — asking the same question twice. Only
// paymentMethodId is load-bearing: it's what Sale.paymentMethodId
// actually stores, and both the cash-drawer and GCash-daily reconciliation
// read from Sale, never from Booking.settledVia/PlayerTab's equivalent.
// deriveSettlementMethod (below) reconstructs the CASH/GCASH value each
// settle action's schema still expects from whichever row was picked, so
// nothing downstream (the schema, the reconciliation, the settledVia
// column) changed — staff just stop being asked twice. Shared by
// settle-booking-form.tsx, tabs-panel.tsx, and walk-in-registration-form.tsx
// — the same three places that used to each hand-roll this pair.
export function deriveSettlementMethod(
  paymentMethods: SettlementPaymentMethodOption[],
  paymentMethodId: string,
): "CASH" | "GCASH" | null {
  return paymentMethods.find((method) => method.id === paymentMethodId)?.key ?? null;
}

interface SettlementPaymentFieldsProps {
  paymentMethods: SettlementPaymentMethodOption[];
  paymentMethodId: string;
  onPaymentMethodIdChange: (paymentMethodId: string) => void;
  gcashReference: string;
  onGcashReferenceChange: (value: string) => void;
  idPrefix?: string;
}

export function SettlementPaymentFields({
  paymentMethods,
  paymentMethodId,
  onPaymentMethodIdChange,
  gcashReference,
  onGcashReferenceChange,
  idPrefix = "settlementPaymentMethod",
}: SettlementPaymentFieldsProps) {
  const selected = paymentMethods.find((method) => method.id === paymentMethodId);
  const isGcash = selected?.key === "GCASH";

  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor={idPrefix} className="text-muted-foreground text-xs">
          Payment method
        </Label>
        <Select value={paymentMethodId} onValueChange={(value) => value && onPaymentMethodIdChange(value)}>
          <SelectTrigger id={idPrefix} className="w-28">
            <SelectValue>{() => selected?.label ?? "Select"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {paymentMethods.map((method) => (
              <SelectItem key={method.id} value={method.id}>
                {method.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isGcash ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}GcashReference`} className="text-muted-foreground text-xs">
            GCash reference
          </Label>
          <Input
            id={`${idPrefix}GcashReference`}
            placeholder="GCash reference number"
            value={gcashReference}
            onChange={(event) => onGcashReferenceChange(event.target.value)}
            className="w-48"
          />
        </div>
      ) : null}
    </>
  );
}
