"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  addBookingProductLineItemAction,
  settleBookingTabAction,
  voidBookingTabLineItemAction,
  writeOffBookingTabAction,
} from "@/actions/booking-tab.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  deriveSettlementMethod,
  SettlementPaymentFields,
} from "@/components/shared/settlement-payment-fields";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SettlementPaymentMethodOption } from "@/lib/settlement-payment-methods";
import { formatCurrency } from "@/lib/utils";

interface LineItemRow {
  id: string;
  description: string;
  qtyOrGames: number;
  amountCents: number;
  type: "PRODUCT" | "ADJUSTMENT";
  voided: boolean;
}

interface ProductOption {
  id: string;
  name: string;
  priceCents: number;
}

interface BookingAddOnsPanelProps {
  bookingId: string;
  tab: { status: "OPEN" | "SETTLED" | "WRITTEN_OFF"; settledVia: "CASH" | "GCASH" | null } | null;
  lineItems: LineItemRow[];
  totalCents: number;
  products: ProductOption[];
  paymentMethods: SettlementPaymentMethodOption[];
}

// Independent of the booking's own court-fee payment (SettleBookingForm/
// RecordGcashPaymentForm elsewhere on this page) by design — a booking
// may already be GCash-prepaid for court time while add-ons are bought
// later at the desk, usually cash. Settling here never touches the
// booking's own Sale. Mirrors features/open-play-capacity/components/
// tabs-panel.tsx's add-on UI, simplified to a single tab (a booking has
// exactly one, unlike an open-play night's many player tabs).
export function BookingAddOnsPanel({
  bookingId,
  tab,
  lineItems,
  totalCents,
  products,
  paymentMethods,
}: BookingAddOnsPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isAddingOn, setIsAddingOn] = useState(false);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [isSettling, setIsSettling] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [gcashReference, setGcashReference] = useState("");

  function refresh() {
    router.refresh();
  }

  function handleAddOn() {
    if (!productId) {
      toast.error("Select an add-on.");
      return;
    }
    startTransition(async () => {
      const result = await addBookingProductLineItemAction({ bookingId, productId, qty: 1 });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const product = products.find((p) => p.id === productId);
      toast.success(`${product?.name ?? "Add-on"} added.`);
      setIsAddingOn(false);
      refresh();
    });
  }

  function handleVoid(lineItemId: string) {
    const reason = window.prompt("Reason for removing this charge?");
    if (!reason?.trim()) return;
    startTransition(async () => {
      const result = await voidBookingTabLineItemAction({
        bookingId,
        lineItemId,
        reason: reason.trim(),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Removed.");
      refresh();
    });
  }

  function handleSettle() {
    const method = deriveSettlementMethod(paymentMethods, paymentMethodId);
    if (!method) {
      toast.error("Select a payment method.");
      return;
    }
    if (method === "GCASH" && !gcashReference.trim()) {
      toast.error("Enter the GCash reference number.");
      return;
    }
    startTransition(async () => {
      const result = await settleBookingTabAction({
        bookingId,
        method,
        gcashReference: method === "GCASH" ? gcashReference.trim() : undefined,
        paymentMethodId,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Add-ons settled.");
      setIsSettling(false);
      refresh();
    });
  }

  function handleWriteOff() {
    const reason = window.prompt("Reason for writing off these add-ons?");
    if (!reason?.trim()) return;
    startTransition(async () => {
      const result = await writeOffBookingTabAction({ bookingId, reason: reason.trim() });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Written off.");
      refresh();
    });
  }

  const activeItems = lineItems.filter((item) => !item.voided && item.type === "PRODUCT");
  const isOpen = !tab || tab.status === "OPEN";

  // Nothing added yet and the booking has no add-ons tab at all — a
  // single "+ Add-on" affordance, not a whole empty panel with a $0
  // total and a Settle button that has nothing to settle.
  if (isOpen && activeItems.length === 0 && !isAddingOn) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add-ons</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => setIsAddingOn(true)}
          >
            + Add-on
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add-ons</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!isOpen ? (
          <Badge variant="outline">
            {tab?.status === "SETTLED" ? `Settled (${tab.settledVia})` : "Written off"}
          </Badge>
        ) : null}

        {activeItems.length > 0 ? (
          <div className="flex flex-col gap-1">
            {activeItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {item.description}
                  {item.qtyOrGames > 1 ? ` x${item.qtyOrGames}` : ""}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatCurrency(item.amountCents)}</span>
                  {isOpen ? (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive text-xs underline"
                      disabled={isPending}
                      onClick={() => handleVoid(item.id)}
                    >
                      Remove
                    </button>
                  ) : null}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 border-t pt-2 text-sm font-medium">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(totalCents)}</span>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No add-ons yet.</p>
        )}

        {isOpen ? (
          <>
            {isAddingOn ? (
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <Select value={productId} onValueChange={(value) => value && setProductId(value)}>
                  <SelectTrigger className="w-48">
                    <SelectValue>
                      {() => {
                        const product = products.find((p) => p.id === productId);
                        return product
                          ? `${product.name} — ${formatCurrency(product.priceCents)}`
                          : "Select an add-on";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} — {formatCurrency(product.priceCents)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending || !productId}
                  onClick={handleAddOn}
                >
                  Add
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => setIsAddingOn(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => setIsAddingOn(true)}
              >
                + Add-on
              </Button>
            )}

            {activeItems.length > 0 ? (
              isSettling ? (
                <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                  <SettlementPaymentFields
                    paymentMethods={paymentMethods}
                    paymentMethodId={paymentMethodId}
                    onPaymentMethodIdChange={setPaymentMethodId}
                    gcashReference={gcashReference}
                    onGcashReferenceChange={setGcashReference}
                    idPrefix={`bookingAddOnsSettle-${bookingId}`}
                  />
                  <Button type="button" size="sm" disabled={isPending} onClick={handleSettle}>
                    Confirm {formatCurrency(totalCents)} settled
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => setIsSettling(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2 border-t pt-3">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending}
                    onClick={() => setIsSettling(true)}
                  >
                    Settle add-ons
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={handleWriteOff}
                  >
                    Write off
                  </Button>
                </div>
              )
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
