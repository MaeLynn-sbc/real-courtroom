"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { settleBookingAction } from "@/actions/booking.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";

interface SettleBookingFormPaymentMethod {
  id: string;
  label: string;
}

interface SettleBookingFormProps {
  bookingId: string;
  amountCents: number;
  paymentMethods: SettleBookingFormPaymentMethod[];
}

// Same "Paid via" + "Payment method" two-field shape as the open-play
// tab settlement form (features/open-play-capacity/components/
// tabs-panel.tsx) — method (CASH/GCASH, drives the required GCash
// reference) is a separate concept from paymentMethodId (which actual
// configured PaymentMethod row the Sale attributes to), same
// distinction that form already established.
export function SettleBookingForm({ bookingId, amountCents, paymentMethods }: SettleBookingFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [method, setMethod] = useState<"CASH" | "GCASH">("CASH");
  const [gcashReference, setGcashReference] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [serverError, setServerError] = useState<string | null>(null);

  function handleSettle() {
    setServerError(null);
    if (method === "GCASH" && !gcashReference.trim()) {
      setServerError("Enter a GCash reference number.");
      return;
    }
    if (!paymentMethodId) {
      setServerError("Select a payment method.");
      return;
    }

    startTransition(async () => {
      const result = await settleBookingAction({
        bookingId,
        method,
        gcashReference: method === "GCASH" ? gcashReference.trim() : undefined,
        paymentMethodId,
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
          This booking hasn&apos;t been paid yet — record the payment once the customer actually pays.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground text-xs">Paid via</Label>
            <Select value={method} onValueChange={(value) => value && setMethod(value as "CASH" | "GCASH")}>
              <SelectTrigger className="w-28">
                <SelectValue>{() => (method === "CASH" ? "Cash" : "GCash")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="GCASH">GCash</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {method === "GCASH" ? (
            <div className="flex flex-col gap-1">
              <Label className="text-muted-foreground text-xs">GCash reference</Label>
              <Input
                placeholder="GCash reference number"
                value={gcashReference}
                onChange={(event) => setGcashReference(event.target.value)}
                className="w-48"
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground text-xs">Payment method</Label>
            <Select value={paymentMethodId} onValueChange={(value) => setPaymentMethodId(value ?? "")}>
              <SelectTrigger className="w-40">
                <SelectValue>
                  {() => paymentMethods.find((pm) => pm.id === paymentMethodId)?.label ?? "Payment method"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {paymentMethods.map((pm) => (
                  <SelectItem key={pm.id} value={pm.id}>
                    {pm.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" disabled={isPending} onClick={handleSettle}>
            Confirm {formatCurrency(amountCents)} settled
          </Button>
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
