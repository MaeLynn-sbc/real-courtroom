"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { correctExpensePaymentMethodAction } from "@/actions/expense.actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Inline correction of an expense's payment method (owner request,
// 2026-09-04): "instead of cash we used gcash".
//
// Only this one field is editable. Amount, date, category and description
// are separate corrections with their own consequences; this exists to fix
// the field that was actually being got wrong.
//
// ⚠ Changing it MOVES MONEY BETWEEN TWO TILLS. Cash and GCash expected
// balances each subtract their own expenses, so switching cash -> GCash
// raises the cash expected balance and lowers the GCash one by the same
// amount. On an open day that simply corrects what staff close against.
// On an already-confirmed day the stored variance is deliberately left
// alone — see expense.service.ts's updateExpensePaymentMethod — so the
// toast says so rather than letting someone assume a closed day
// re-balanced itself.
export function ExpensePaymentMethodCell({
  expenseId,
  paymentMethodId,
  paymentMethods,
}: {
  expenseId: string;
  paymentMethodId: string;
  paymentMethods: { id: string; label: string }[];
}) {
  const [value, setValue] = useState(paymentMethodId);
  const [isPending, startTransition] = useTransition();

  const change = (next: string | null) => {
    if (!next || next === value) {
      return;
    }
    const previous = value;
    // Optimistic: the select should not visibly snap back while the
    // server round-trips, but it MUST revert if the write fails —
    // silently keeping the new label over unchanged data would be worse
    // than the original error.
    setValue(next);
    startTransition(async () => {
      const result = await correctExpensePaymentMethodAction({
        expenseId,
        paymentMethodId: next,
      });
      if (result.error) {
        setValue(previous);
        toast.error(result.error);
        return;
      }
      toast.success(
        "Payment method corrected. Expected till balances update on the next read; a day already closed keeps its recorded variance.",
      );
    });
  };

  return (
    <Select value={value} onValueChange={change} disabled={isPending}>
      <SelectTrigger className="h-8 w-[140px]" aria-label="Payment method">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {paymentMethods.map((method) => (
          <SelectItem key={method.id} value={method.id}>
            {method.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
