"use client";

import { Check, Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  addAdjustmentAction,
  addProductLineItemAction,
  settleTabAction,
  writeOffTabAction,
} from "@/actions/player-tab.actions";
import { updateRegistrationDetailsAction } from "@/actions/open-play-registration.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  deriveSettlementMethod,
  SettlementPaymentFields,
} from "@/components/shared/settlement-payment-fields";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SettlementPaymentMethodOption } from "@/lib/settlement-payment-methods";
import { cn, formatCurrency } from "@/lib/utils";

// A brief, visible confirmation before a settled row actually leaves
// the open-tabs list — see handleSettle below.
const SETTLE_SUCCESS_DISPLAY_MS = 900;

interface TabRow {
  id: string;
  registrationId: string;
  playerName: string;
  status: "OPEN" | "SETTLED" | "WRITTEN_OFF";
  totalCents: number;
  gamesPlayed: number;
  settledVia: "CASH" | "GCASH" | null;
}

interface ProductOption {
  id: string;
  name: string;
  priceCents: number;
}

export function TabsPanel({
  tabs,
  paymentMethods,
  products,
}: {
  tabs: TabRow[];
  paymentMethods: SettlementPaymentMethodOption[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openTabId, setOpenTabId] = useState<string | null>(null);
  const [gcashReference, setGcashReference] = useState("");
  // Owner request (2026-08-08), root-cause fix: no default selection — an
  // attendant must actively pick CASH or GCASH for every settlement, see
  // settlement-payment-fields.tsx's own top comment.
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [adjustDescription, setAdjustDescription] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [addOnOpenTabId, setAddOnOpenTabId] = useState<string | null>(null);
  const [addOnProductId, setAddOnProductId] = useState(products[0]?.id ?? "");
  const [justSettledTabId, setJustSettledTabId] = useState<string | null>(null);
  // Reported live: no way anywhere to fix a typo'd name short of
  // cancelling and re-registering. Moved here from the Rotation Board's
  // "Next up" preview — "that's not the place for editing names" — the
  // tab is where staff actually deal with a player by name for the
  // whole night, so a correction here also fixes the tab's own
  // (snapshotted) name, not just the underlying registration.
  const [editNameTabId, setEditNameTabId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");

  function refresh() {
    router.refresh();
  }

  function resetSettleForm() {
    setOpenTabId(null);
    setGcashReference("");
    // Reset back to no selection — every settlement starts unchosen, not
    // just the first one (see paymentMethodId's own comment above).
    setPaymentMethodId("");
    setAdjustDescription("");
    setAdjustAmount("");
    setAdjustReason("");
  }

  function handleSettle(tabId: string) {
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
      const result = await settleTabAction({
        tabId,
        method,
        gcashReference: method === "GCASH" ? gcashReference.trim() : undefined,
        paymentMethodId,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Tab settled.");
      // Show a clear success moment in the row itself before it leaves
      // the open-tabs list — router.refresh() below would otherwise move
      // it straight to "settled/written-off" with no visible transition.
      setJustSettledTabId(tabId);
      setTimeout(() => {
        setJustSettledTabId(null);
        resetSettleForm();
        refresh();
      }, SETTLE_SUCCESS_DISPLAY_MS);
    });
  }

  function handleAddOn(tabId: string) {
    if (!addOnProductId) {
      toast.error("Select an add-on.");
      return;
    }
    startTransition(async () => {
      const result = await addProductLineItemAction({ tabId, productId: addOnProductId, qty: 1 });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const product = products.find((p) => p.id === addOnProductId);
      toast.success(`${product?.name ?? "Add-on"} added.`);
      setAddOnOpenTabId(null);
      refresh();
    });
  }

  function handleAddAdjustment(tabId: string) {
    const amountCents = Math.round(Number(adjustAmount) * 100);
    if (!adjustDescription.trim() || Number.isNaN(amountCents) || !adjustReason.trim()) {
      toast.error("Enter a description, amount, and reason.");
      return;
    }
    startTransition(async () => {
      const result = await addAdjustmentAction({
        tabId,
        description: adjustDescription.trim(),
        amountCents,
        reason: adjustReason.trim(),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Adjustment added.");
      setAdjustDescription("");
      setAdjustAmount("");
      setAdjustReason("");
      refresh();
    });
  }

  function handleSaveName(registrationId: string) {
    const playerName = editNameValue.trim();
    if (!playerName) {
      toast.error("Enter a name.");
      return;
    }
    startTransition(async () => {
      const result = await updateRegistrationDetailsAction({ registrationId, playerName });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Name corrected.");
      setEditNameTabId(null);
      refresh();
    });
  }

  function handleWriteOff(tabId: string) {
    const reason = window.prompt("Reason for writing off this tab?");
    if (!reason?.trim()) return;
    startTransition(async () => {
      const result = await writeOffTabAction({ tabId, reason: reason.trim() });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Tab written off.");
      refresh();
    });
  }

  const openTabs = tabs.filter((t) => t.status === "OPEN");
  const otherTabs = tabs.filter((t) => t.status !== "OPEN");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tabs ({openTabs.length} open)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {openTabs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No open tabs.</p>
        ) : (
          openTabs.map((tab) => {
            const isSettling = openTabId === tab.id;
            const justSettled = justSettledTabId === tab.id;
            const isEditingName = editNameTabId === tab.id;
            return (
              <div
                key={tab.id}
                className={cn(
                  "rounded-lg border px-3 py-3 transition-colors",
                  (isSettling || justSettled) && "border-primary/50 bg-primary/[0.04]",
                )}
              >
                {justSettled ? (
                  <div className="text-success flex items-center gap-2 py-1 text-sm font-medium">
                    <Check className="size-4" aria-hidden="true" />
                    {tab.playerName} — {formatCurrency(tab.totalCents)} settled.
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div>
                          <p
                            className={cn(
                              "flex items-center gap-1.5 font-medium",
                              isSettling && "text-base font-semibold",
                            )}
                          >
                            {tab.playerName}
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={`Edit ${tab.playerName}'s name`}
                              disabled={isPending}
                              onClick={() => {
                                setEditNameTabId(isEditingName ? null : tab.id);
                                setEditNameValue(tab.playerName);
                              }}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {tab.gamesPlayed} game{tab.gamesPlayed === 1 ? "" : "s"}
                          </p>
                        </div>
                        {/* Reported on an old, low-contrast laptop screen: the
                            bill used to be the smallest, greyest thing on the
                            row (text-xs text-muted-foreground), easy to miss
                            next to the player's name. Pulled out into its own
                            larger, bolder, highlighted chip — bigger than the
                            name above, not just "not muted." */}
                        <span className="bg-primary/10 text-primary rounded-md px-2.5 py-1 text-lg font-bold tabular-nums">
                          {formatCurrency(tab.totalCents)}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() =>
                            setAddOnOpenTabId(addOnOpenTabId === tab.id ? null : tab.id)
                          }
                        >
                          + Add-on
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => {
                            // Opening a DIFFERENT tab's settle panel must
                            // start unchosen too, not carry over whichever
                            // method was last picked for another tab.
                            setPaymentMethodId("");
                            setGcashReference("");
                            setOpenTabId(isSettling ? null : tab.id);
                          }}
                        >
                          {isSettling ? "Cancel" : "Settle"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => handleWriteOff(tab.id)}
                        >
                          Write off
                        </Button>
                      </div>
                    </div>

                    {isEditingName ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                        <Input
                          value={editNameValue}
                          onChange={(e) => setEditNameValue(e.target.value)}
                          placeholder="Corrected name"
                          className="w-56"
                          autoFocus
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleSaveName(tab.registrationId)}
                        >
                          Save name
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => setEditNameTabId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : null}

                    {addOnOpenTabId === tab.id ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                        <Select
                          value={addOnProductId}
                          onValueChange={(v) => setAddOnProductId(v ?? "")}
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue>
                              {() =>
                                products.find((p) => p.id === addOnProductId)
                                  ? `${products.find((p) => p.id === addOnProductId)!.name} — ${formatCurrency(products.find((p) => p.id === addOnProductId)!.priceCents)}`
                                  : "Select an add-on"
                              }
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
                          disabled={isPending || !addOnProductId}
                          onClick={() => handleAddOn(tab.id)}
                        >
                          Add
                        </Button>
                      </div>
                    ) : null}

                    {isSettling ? (
                      <div className="mt-3 flex flex-col gap-3 border-t pt-3">
                        <div className="flex flex-wrap items-end gap-2">
                          <SettlementPaymentFields
                            paymentMethods={paymentMethods}
                            paymentMethodId={paymentMethodId}
                            onPaymentMethodIdChange={setPaymentMethodId}
                            gcashReference={gcashReference}
                            onGcashReferenceChange={setGcashReference}
                            idPrefix={`tabSettlePaymentMethod-${tab.id}`}
                            amountCents={tab.totalCents}
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={isPending || !paymentMethodId}
                            onClick={() => handleSettle(tab.id)}
                          >
                            Confirm {formatCurrency(tab.totalCents)} settled
                          </Button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            placeholder="Adjustment description"
                            value={adjustDescription}
                            onChange={(e) => setAdjustDescription(e.target.value)}
                            className="w-44"
                          />
                          <Input
                            placeholder="Amount (₱, negative for discount)"
                            type="number"
                            step="0.01"
                            value={adjustAmount}
                            onChange={(e) => setAdjustAmount(e.target.value)}
                            className="w-48"
                          />
                          <Input
                            placeholder="Reason (required)"
                            value={adjustReason}
                            onChange={(e) => setAdjustReason(e.target.value)}
                            className="w-44"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() => handleAddAdjustment(tab.id)}
                          >
                            Add adjustment
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            );
          })
        )}

        {otherTabs.length > 0 ? (
          <details className="mt-2">
            <summary className="text-muted-foreground cursor-pointer text-xs">
              {otherTabs.length} settled / written-off tab{otherTabs.length === 1 ? "" : "s"}
            </summary>
            <div className="mt-2 flex flex-col gap-1">
              {otherTabs.map((tab) => (
                <div key={tab.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{tab.playerName}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant="outline">
                      {tab.status === "SETTLED" ? `Settled (${tab.settledVia})` : "Written off"}
                    </Badge>
                    <span className="text-muted-foreground">{formatCurrency(tab.totalCents)}</span>
                  </span>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
