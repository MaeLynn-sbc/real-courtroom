"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createExpenseAction } from "@/actions/expense.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import type { SettlementPaymentMethodOption } from "@/lib/settlement-payment-methods";

function toDateInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Owner request (2026-08-09), from the Coaching report: "the coach will
// collect the fees from the court [directly, in person] ... then we will
// give them their ... coaching fees and mark a date when, and it will
// less with our gcash amount or our cash total sales." A coach's session
// fee never touches the register — this records the OPPOSITE direction
// from a Sale: a real cash/GCash OUTFLOW when the owner pays the coach
// out, using the existing generic Expense flow (createExpenseAction),
// which already reduces that day's Cash/GCash reconciliation via
// Expense.paymentMethodId — see expense.service.ts's own comment. No new
// service/permission needed; this is just a coaching-report-scoped
// front end onto an existing, already-audited money path.
export function CoachPayoutForm({
  coachName,
  defaultAmountCents,
  categoryId,
  paymentMethods,
  weekLabel,
}: {
  coachName: string;
  defaultAmountCents: number;
  categoryId: string | undefined;
  paymentMethods: SettlementPaymentMethodOption[];
  weekLabel: string;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  // ⚠ These are SEEDED from props, not synced to them — useState's
  // argument is only the initial value. If a caller re-renders this
  // component with a different week's defaultAmountCents/weekLabel, the
  // fields keep the old ones. That is exactly what happened on 2026-08-27:
  // switching week tabs is a soft navigation, React reused the instance,
  // and the form still showed the previous week's amount and label.
  //
  // Callers MUST key this component by the week it belongs to (see
  // coaching-weekly-report.tsx) so a week change remounts it. Deliberately
  // not "fixed" here by syncing state to props in an effect — that is the
  // pattern React documents against, and it would also discard whatever
  // the owner had typed mid-edit on every parent re-render.
  const [amount, setAmount] = useState((defaultAmountCents / 100).toFixed(2));
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [description, setDescription] = useState(`Coach payout — ${coachName}, week of ${weekLabel}`);
  // Same root-cause discipline as the settlement/coaching pickers: no
  // default selection, must actively choose.
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [isPending, startTransition] = useTransition();
  const selected = paymentMethods.find((method) => method.id === paymentMethodId);

  function handleSubmit() {
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    if (!categoryId) {
      toast.error('No "Coach Payouts" expense category exists yet — add one on the Expenses page first.');
      return;
    }

    startTransition(async () => {
      const result = await createExpenseAction({
        amountCents,
        date,
        description: description.trim() || `Coach payout — ${coachName}`,
        categoryId,
        paymentMethodId,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Payout to ${coachName} recorded.`);
      setIsOpen(false);
      router.refresh();
    });
  }

  if (!isOpen) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setIsOpen(true)}>
        Pay coach
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">Pay {coachName}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`payoutAmount-${coachName}`} className="text-muted-foreground text-xs">
            Amount (₱)
          </Label>
          <Input
            id={`payoutAmount-${coachName}`}
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`payoutDate-${coachName}`} className="text-muted-foreground text-xs">
            Date paid
          </Label>
          <Input
            id={`payoutDate-${coachName}`}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={isPending}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`payoutDescription-${coachName}`} className="text-muted-foreground text-xs">
          Description
        </Label>
        <Input
          id={`payoutDescription-${coachName}`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={isPending}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Paid from</span>
        <div className="flex gap-1" role="group" aria-label="Payment method">
          {paymentMethods.map((method) => {
            const isSelected = method.id === paymentMethodId;
            return (
              <Button
                key={method.id}
                type="button"
                size="sm"
                variant={isSelected ? "default" : "outline"}
                aria-pressed={isSelected}
                disabled={isPending}
                onClick={() => setPaymentMethodId(method.id)}
                className="font-bold uppercase"
              >
                {method.label}
              </Button>
            );
          })}
        </div>
        {selected ? (
          <span className="text-muted-foreground text-xs">
            Paying {formatCurrency(Math.round(Number(amount) * 100) || 0)} out of {selected.label.toUpperCase()}
          </span>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={isPending || !paymentMethodId} onClick={handleSubmit}>
          {isPending ? "Saving…" : "Confirm payout"}
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
    </div>
  );
}
