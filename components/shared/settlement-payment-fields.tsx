"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
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
  // Owner request (2026-08-08), root-cause fix for attendants recording a
  // Cash payment as GCash (or the reverse): backs the confirmation echo
  // below ("Settling ₱350 as CASH") — the one moment a wrong choice is
  // visible before it commits. Optional: not every consumer has a fixed
  // amount at render time.
  amountCents?: number;
}

// Real dropdown, silently defaulted to Cash (paymentMethods[0]), was the
// root cause here — not the symptom (a variance after the fact). Two
// equal-size buttons instead of a 112px-wide Select: neither starts
// selected (callers now initialize paymentMethodId to "", not
// paymentMethods[0]?.id), so an attendant must actively choose, and a
// wrong choice is visually loud (a solid, filled button) rather than a
// small label inside a closed dropdown. Callers must also disable their
// own Confirm/Submit button on `!paymentMethodId` — this component only
// renders the picker, it can't block a caller's submit itself.
export function SettlementPaymentFields({
  paymentMethods,
  paymentMethodId,
  onPaymentMethodIdChange,
  gcashReference,
  onGcashReferenceChange,
  idPrefix = "settlementPaymentMethod",
  amountCents,
}: SettlementPaymentFieldsProps) {
  const selected = paymentMethods.find((method) => method.id === paymentMethodId);
  const isGcash = selected?.key === "GCASH";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Payment method</span>
        <div className="flex gap-2" role="group" aria-label="Payment method">
          {paymentMethods.map((method) => {
            const isSelected = method.id === paymentMethodId;
            return (
              <Button
                key={method.id}
                type="button"
                id={`${idPrefix}-${method.key}`}
                variant={isSelected ? "default" : "outline"}
                aria-pressed={isSelected}
                onClick={() => onPaymentMethodIdChange(method.id)}
                className="h-14 flex-1 text-base font-bold tracking-wide uppercase"
              >
                {method.label}
              </Button>
            );
          })}
        </div>
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
      {/* The one moment a wrong tap is visible before it commits — see
          this component's own top comment. */}
      {selected && amountCents !== undefined ? (
        <p className="text-lg font-bold">
          Settling {formatCurrency(amountCents)} as {selected.label.toUpperCase()}
        </p>
      ) : null}
    </div>
  );
}
