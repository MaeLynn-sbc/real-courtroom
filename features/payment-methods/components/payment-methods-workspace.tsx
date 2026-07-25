"use client";

import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createPaymentMethodAction,
  setPaymentMethodActiveAction,
  updatePaymentMethodAction,
} from "@/actions/payment-method.actions";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { saleService } from "@/services/sales/sale.service";

type PaymentMethods = Awaited<ReturnType<typeof saleService.listPaymentMethods>>;

interface PaymentMethodsWorkspaceProps {
  paymentMethods: PaymentMethods;
}

function PaymentMethodRow({ method }: { method: PaymentMethods[number] }) {
  const router = useRouter();
  const labelId = useId();
  const orderId = useId();
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
    // A disabled method isn't a warning, it's just not in play right now —
    // dimmed, not amber (BUILD-SPEC.md §2, "disabled / inactive").
    <Card className={cn(!method.isActive && "opacity-60")}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-muted-foreground font-mono text-xs tracking-wide">{method.key}</p>
          <div className="flex items-center gap-2">
            <Switch
              tone="status"
              checked={method.isActive}
              onCheckedChange={handleToggleActive}
              disabled={isToggling}
              aria-label={method.isActive ? "Disable payment method" : "Enable payment method"}
            />
            <Badge variant={method.isActive ? "status" : "outline"}>
              {method.isActive ? "Active" : "Disabled"}
            </Badge>
          </div>
        </div>
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
          <Button type="button" size="sm" variant="outline" disabled={isSaving} onClick={handleSave}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
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
