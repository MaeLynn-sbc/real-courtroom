"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { regenerateBookingQrTokenAction } from "@/actions/booking.actions";
import { Button } from "@/components/ui/button";

interface RegenerateQrButtonProps {
  bookingId: string;
}

// Makes the QR "revocable": regenerating overwrites the old token, so any
// previously issued QR image immediately stops working.
export function RegenerateQrButton({ bookingId }: RegenerateQrButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await regenerateBookingQrTokenAction(bookingId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("QR code regenerated — the old code no longer works.");
      router.refresh();
    });
  }

  return (
    <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleClick}>
      {isPending ? "Regenerating…" : "Regenerate QR"}
    </Button>
  );
}
