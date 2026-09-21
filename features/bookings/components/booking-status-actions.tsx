"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { updateBookingStatusAction } from "@/actions/booking.actions";
import { ConfirmActionButton } from "@/components/shared/confirm-action-button";
import { Button } from "@/components/ui/button";
import type { BookingStatus } from "@/lib/generated/prisma/enums";
// Only the pure state-machine module is imported here (no lib/env.ts /
// lib/prisma.ts in its dependency chain) — never import
// services/booking/booking.service.ts itself from a "use client" file.
import { BOOKING_STATUS_TRANSITIONS } from "@/services/booking/booking-status";

// AWAITING_PAYMENT/PENDING_VERIFICATION/REJECTED/REFUNDED (Phase 8
// plumbing, Gate 1) are unreachable — BOOKING_STATUS_TRANSITIONS has no
// entry that transitions into any of them yet, so these labels exist
// only for type-safety (Record<BookingStatus, string> is exhaustive) and
// are never rendered until Gate 2 wires real transitions in.
const STATUS_ACTION_LABELS: Record<BookingStatus, string> = {
  PENDING: "Mark pending",
  CONFIRMED: "Confirm",
  PAID: "Mark paid",
  CHECKED_IN: "Check in",
  COMPLETED: "Mark complete",
  CANCELLED: "Cancel",
  NO_SHOW: "Mark no-show",
  AWAITING_PAYMENT: "Awaiting payment",
  PENDING_VERIFICATION: "Verify payment",
  REJECTED: "Reject",
  REFUNDED: "Mark refunded",
};

interface BookingStatusActionsProps {
  bookingId: string;
  currentStatus: BookingStatus;
  // True once a COMPLETED Sale exists for this booking. Cancelling is
  // then refused server-side (BookingPaidCannotCancelError) because it
  // would leave the payment counting as revenue — see that error's own
  // comment for the P700 incident. Not offered here either, so staff
  // meet the explanation before the dead end rather than after it.
  // NO_SHOW stays available: the venue keeps that money.
  isPaid?: boolean;
}

export function BookingStatusActions({
  bookingId,
  currentStatus,
  isPaid = false,
}: BookingStatusActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const allTransitions = BOOKING_STATUS_TRANSITIONS[currentStatus];
  const availableTransitions = isPaid
    ? allTransitions.filter((status) => status !== "CANCELLED")
    : allTransitions;
  const cancelWithheld = isPaid && allTransitions.includes("CANCELLED");

  function handleTransition(status: BookingStatus) {
    startTransition(async () => {
      const result = await updateBookingStatusAction(bookingId, { status });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Booking updated.");
      router.refresh();
    });
  }

  if (availableTransitions.length === 0 && !cancelWithheld) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {cancelWithheld ? (
        <p className="text-muted-foreground text-sm">
          This booking is paid, so it can&apos;t be cancelled — that would leave the payment
          counting as revenue. Use <span className="font-medium">Refund</span> under Payment to give
          the money back, or <span className="font-medium">Move booking</span> if only the court or
          time was wrong.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {availableTransitions.map((status) =>
          status === "CANCELLED" || status === "NO_SHOW" ? (
            <ConfirmActionButton
              key={status}
              title={
                status === "CANCELLED" ? "Cancel this booking?" : "Mark this booking as no-show?"
              }
              description={
                status === "CANCELLED"
                  ? "This frees up the court for this time slot. This can't be undone."
                  : "This marks the player as having missed their booking. This can't be undone."
              }
              confirmLabel={
                status === "CANCELLED" ? "Cancel booking" : STATUS_ACTION_LABELS[status]
              }
              cancelLabel={status === "CANCELLED" ? "Keep booking" : undefined}
              disabled={isPending}
              onConfirm={() => handleTransition(status)}
            >
              {STATUS_ACTION_LABELS[status]}
            </ConfirmActionButton>
          ) : (
            <Button
              key={status}
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => handleTransition(status)}
            >
              {STATUS_ACTION_LABELS[status]}
            </Button>
          ),
        )}
      </div>
    </div>
  );
}
