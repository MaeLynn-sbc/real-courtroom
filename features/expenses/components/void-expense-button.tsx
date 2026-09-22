"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { voidExpenseAction } from "@/actions/expense.actions";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

// Owner-reported incident (2026-09-21): the same P8,200 coach payout was
// recorded twice on a slow connection, and there was no way to take
// either one off the books. This is that reversal — a void, not a
// delete, so the row and its receipt stay on this screen (struck
// through) and the reconciliation can still be explained later.
export function VoidExpenseButton({
  expenseId,
  amountCents,
  description,
}: {
  expenseId: string;
  amountCents: number;
  description: string;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!isOpen) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setIsOpen(true)}>
        Reverse
      </Button>
    );
  }

  function handleSubmit() {
    if (!reason.trim()) {
      toast.error("Enter a reason for this reversal.");
      return;
    }
    startTransition(async () => {
      const result = await voidExpenseAction({ expenseId, reason: reason.trim() });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${formatCurrency(amountCents)} reversed — it no longer counts as money out.`);
      setIsOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex min-w-64 flex-col gap-2 rounded-lg border p-2">
      <p className="text-muted-foreground text-xs">
        Reverse {formatCurrency(amountCents)} ({description})? It stops counting against that
        day&apos;s cash or GCash. The row stays here, marked reversed.
      </p>
      <input
        type="text"
        placeholder="Reason (e.g. recorded twice by mistake)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={isPending} onClick={handleSubmit}>
          {isPending ? "Reversing…" : "Confirm reversal"}
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
