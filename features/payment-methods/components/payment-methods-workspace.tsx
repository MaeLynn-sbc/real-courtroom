"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { Switch } from "@/components/ui/switch";
import type { saleService } from "@/services/sales/sale.service";

type PaymentMethods = Awaited<ReturnType<typeof saleService.listPaymentMethods>>;

interface PaymentMethodsWorkspaceProps {
  paymentMethods: PaymentMethods;
}

function PaymentMethodRow({ method }: { method: PaymentMethods[number] }) {
  const router = useRouter();
  const [label, setLabel] = useState(method.label);
  const [sortOrder, setSortOrder] = useState(String(method.sortOrder));
  const [isSaving, startSaveTransition] = useTransition();
  const [isToggling, startToggleTransition] = useTransition();

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
    <div className="flex flex-col gap-2 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground text-xs">{method.key}</p>
        <div className="flex items-center gap-2">
          <Switch
            checked={method.isActive}
            onCheckedChange={handleToggleActive}
            disabled={isToggling}
            aria-label={method.isActive ? "Disable payment method" : "Enable payment method"}
          />
          <span className="text-muted-foreground text-xs">
            {method.isActive ? "Active" : "Disabled"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input value={label} onChange={(event) => setLabel(event.target.value)} className="flex-1" />
        <Input
          type="number"
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value)}
          className="w-20"
          aria-label="Sort order"
        />
        <Button type="button" size="sm" variant="outline" disabled={isSaving} onClick={handleSave}>
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
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
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="paymentMethodLabel">Label</Label>
              <Input
                id="paymentMethodLabel"
                placeholder="E-Wallet"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </div>
          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
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
