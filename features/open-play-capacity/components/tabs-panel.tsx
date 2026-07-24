"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  addAdjustmentAction,
  addRentalLineItemAction,
  settleTabAction,
  writeOffTabAction,
} from "@/actions/player-tab.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { EQUIPMENT_KEYS } from "@/lib/equipment-keys";

interface TabRow {
  id: string;
  playerName: string;
  status: "OPEN" | "SETTLED" | "WRITTEN_OFF";
  totalCents: number;
  gamesPlayed: number;
  settledVia: "CASH" | "GCASH" | null;
}

interface PaymentMethodOption {
  id: string;
  label: string;
}

export function TabsPanel({ tabs, paymentMethods }: { tabs: TabRow[]; paymentMethods: PaymentMethodOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openTabId, setOpenTabId] = useState<string | null>(null);
  const [method, setMethod] = useState<"CASH" | "GCASH">("CASH");
  const [gcashReference, setGcashReference] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [adjustDescription, setAdjustDescription] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  function refresh() {
    router.refresh();
  }

  function resetSettleForm() {
    setOpenTabId(null);
    setMethod("CASH");
    setGcashReference("");
    setAdjustDescription("");
    setAdjustAmount("");
    setAdjustReason("");
  }

  function handleSettle(tabId: string) {
    if (method === "GCASH" && !gcashReference.trim()) {
      toast.error("Enter the GCash reference number.");
      return;
    }
    if (!paymentMethodId) {
      toast.error("Select a payment method.");
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
      resetSettleForm();
      refresh();
    });
  }

  function handleAddPaddle(tabId: string) {
    startTransition(async () => {
      const result = await addRentalLineItemAction({
        tabId,
        equipmentKey: EQUIPMENT_KEYS.HOUSE_PADDLE,
        description: "Paddle rental",
        qty: 1,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Paddle rental added.");
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
          openTabs.map((tab) => (
            <div key={tab.id} className="rounded-lg border px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{tab.playerName}</p>
                  <p className="text-muted-foreground text-xs">
                    {tab.gamesPlayed} game{tab.gamesPlayed === 1 ? "" : "s"} · {formatCurrency(tab.totalCents)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => handleAddPaddle(tab.id)}>
                    + Paddle
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => setOpenTabId(openTabId === tab.id ? null : tab.id)}
                  >
                    {openTabId === tab.id ? "Cancel" : "Settle"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => handleWriteOff(tab.id)}>
                    Write off
                  </Button>
                </div>
              </div>

              {openTabId === tab.id ? (
                <div className="mt-3 flex flex-col gap-3 border-t pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={method} onValueChange={(v) => setMethod(v as "CASH" | "GCASH")}>
                      <SelectTrigger className="w-28">
                        <SelectValue>{() => (method === "CASH" ? "Cash" : "GCash")}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CASH">Cash</SelectItem>
                        <SelectItem value="GCASH">GCash</SelectItem>
                      </SelectContent>
                    </Select>
                    {method === "GCASH" ? (
                      <Input
                        placeholder="GCash reference number"
                        value={gcashReference}
                        onChange={(e) => setGcashReference(e.target.value)}
                        className="w-48"
                      />
                    ) : null}
                    <Select value={paymentMethodId} onValueChange={(v) => setPaymentMethodId(v ?? "")}>
                      <SelectTrigger className="w-40">
                        <SelectValue>{() => paymentMethods.find((p) => p.id === paymentMethodId)?.label ?? "Payment method"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {paymentMethods.map((pm) => (
                          <SelectItem key={pm.id} value={pm.id}>
                            {pm.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" size="sm" disabled={isPending} onClick={() => handleSettle(tab.id)}>
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
                    <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => handleAddAdjustment(tab.id)}>
                      Add adjustment
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))
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
                    <Badge variant="outline">{tab.status === "SETTLED" ? `Settled (${tab.settledVia})` : "Written off"}</Badge>
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
