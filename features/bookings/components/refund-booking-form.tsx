"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { refundBookingAction } from "@/actions/booking.actions";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

interface RefundBookingFormProps {
  bookingId: string;
  amountCents: number;
  paymentMethodLabel: string;
}

// Owner request (2026-09-22). The P700 incident this closes: a booking
// was settled, cancelled a minute later for a wrong time, and rebooked —
// the first payment stayed on the books, so the day's GCash came out
// P700 short with only a staff note to explain it. Cancel is now refused
// on a paid booking (BookingPaidCannotCancelError) and this is the
// button it points at.
//
// Collapsed behind one button, same shape as
// CorrectSalePaymentMethodForm: this is money leaving, so it never sits
// open as a one-click control next to the ordinary status buttons.
export function RefundBookingForm({
  bookingId,
  amountCents,
  paymentMethodLabel,
}: RefundBookingFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  if (!isOpen) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setIsOpen(true)}>
        Refund
      </Button>
    );
  }

  function handleSubmit() {
    setServerError(null);
    if (!reason.trim()) {
      setServerError("Enter a reason for this refund.");
      return;
    }

    startTransition(async () => {
      const result = await refundBookingAction({ bookingId, reason: reason.trim() });
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(`Refunded ${formatCurrency(amountCents)} — the sale is voided.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-muted-foreground text-xs">
        Refunds the full {formatCurrency(amountCents)} paid by {paymentMethodLabel} and voids the
        sale, so it stops counting as revenue. Hand the money back yourself — this records it, it
        doesn&apos;t send it. The booking becomes Refunded and the court is freed.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Reason (e.g. duplicate booking, paid twice)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="border-input h-9 min-w-48 flex-1 rounded-md border bg-transparent px-3 text-sm"
        />
        <Button type="button" size="sm" disabled={isPending} onClick={handleSubmit}>
          Refund {formatCurrency(amountCents)}
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
      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}
    </div>
  );
}
