"use client";

import { Banknote, CreditCard, Landmark, Smartphone, Store, TriangleAlert, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createPaymentMethodAction,
  setPaymentMethodActiveAction,
  updatePaymentMethodAction,
} from "@/actions/payment-method.actions";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RecordCard, recordCardAccentButtonClass, type RecordCardRamp } from "@/components/ui/record-card";
import { Switch } from "@/components/ui/switch";
import type { saleService } from "@/services/sales/sale.service";

type PaymentMethods = Awaited<ReturnType<typeof saleService.listPaymentMethods>>;

interface PaymentMethodsWorkspaceProps {
  paymentMethods: PaymentMethods;
}

// Per BUILD-SPEC.md §2's "record card" ramp table — chosen for real-world
// resonance (GCash's own brand is blue, cash is warm/physical, banking
// reads institutional, card networks lean red), not arbitrary. A key
// this app didn't seed (a custom method a staff member adds later) falls
// back to the neutral "no natural color" default rather than guessing.
const PAYMENT_METHOD_PRESENTATION: Record<string, { icon: LucideIcon; ramp: RecordCardRamp }> = {
  CASH: { icon: Banknote, ramp: "amber" },
  GCASH: { icon: Smartphone, ramp: "sky" },
  BANK_TRANSFER: { icon: Landmark, ramp: "violet" },
  CARD: { icon: CreditCard, ramp: "rose" },
  PAY_AT_VENUE: { icon: Store, ramp: "slate" },
};
const DEFAULT_PRESENTATION = { icon: Wallet, ramp: "slate" as const };

function PaymentMethodRow({ method }: { method: PaymentMethods[number] }) {
  const router = useRouter();
  const labelId = useId();
  const orderId = useId();
  const [label, setLabel] = useState(method.label);
  const [sortOrder, setSortOrder] = useState(String(method.sortOrder));
  const [isSaving, startSaveTransition] = useTransition();
  const [isToggling, startToggleTransition] = useTransition();
  const { icon, ramp } = PAYMENT_METHOD_PRESENTATION[method.key] ?? DEFAULT_PRESENTATION;

  function handleSave() {
    startSaveTransition(async () => {
      const result = await updatePaymentMethodAction(method.id, {
        label,
        sortOrder: Number(sortOrder),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Payment method saved.");
      router.refresh();
    });
  }

  function handleToggleActive() {
    startToggleTransition(async () => {
      const result = await setPaymentMethodActiveAction(method.id, !method.isActive);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(method.isActive ? "Payment method disabled." : "Payment method enabled.");
      router.refresh();
    });
  }

  return (
    <RecordCard ramp={ramp} icon={icon} title={method.key} active={method.isActive}>
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor={labelId} className="text-muted-foreground text-xs">
              Label
            </Label>
            <Input id={labelId} value={label} onChange={(event) => setLabel(event.target.value)} />
          </div>
          <div className="flex w-20 flex-col gap-1.5">
            <Label htmlFor={orderId} className="text-muted-foreground text-xs">
              Order
            </Label>
            <Input
              id={orderId}
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={isSaving}
            onClick={handleSave}
            className={recordCardAccentButtonClass(ramp)}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
        {/* The header pill (RecordCard) shows current state; this is the
            actual control that changes it. */}
        <div className="flex items-center gap-2">
          <Switch
            checked={method.isActive}
            onCheckedChange={handleToggleActive}
            disabled={isToggling}
            aria-label={method.isActive ? "Disable payment method" : "Enable payment method"}
          />
          <span className="text-muted-foreground text-xs">
            {method.isActive ? "Active — tap to disable" : "Disabled — tap to enable"}
          </span>
        </div>
      </div>
    </RecordCard>
  );
}

function AddPaymentMethodForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    startTransition(async () => {
      const result = await createPaymentMethodAction({ key: key.trim().toUpperCase(), label });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Payment method added.");
      setKey("");
      setLabel("");
      router.refresh();
    });
  }

  // Presentation only — the schema (payment-method.schema.ts) still
  // returns a single message string, unchanged. This just points the
  // existing error at the field it's actually about, reusing the
  // aria-invalid:border-destructive styling Input already ships with
  // but this form never wired up.
  const keyHasError = serverError !== null && /\bkey\b/i.test(serverError);
  const labelHasError = serverError !== null && /\blabel\b/i.test(serverError);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a payment method</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="paymentMethodKey">Key</Label>
              <Input
                id="paymentMethodKey"
                placeholder="E_WALLET"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                aria-invalid={keyHasError}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="paymentMethodLabel">Label</Label>
              <Input
                id="paymentMethodLabel"
                placeholder="E-Wallet"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                aria-invalid={labelHasError}
              />
            </div>
          </div>
          {serverError ? (
            <div
              role="alert"
              className="border-destructive/40 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <TriangleAlert className="size-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          ) : null}
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Adding…" : "Add payment method"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function PaymentMethodsWorkspace({ paymentMethods }: PaymentMethodsWorkspaceProps) {
  return (
    <div className="flex flex-col gap-6">
      <AddPaymentMethodForm />

      {paymentMethods.length === 0 ? (
        <EmptyState
          title="No payment methods yet."
          description="Add one above to get started."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {paymentMethods.map((method) => (
            <PaymentMethodRow key={method.id} method={method} />
          ))}
        </div>
      )}
    </div>
  );
}
