"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { changeBookingCourtAction } from "@/actions/booking.actions";
import { Button } from "@/components/ui/button";

interface SwitchCourtFormProps {
  bookingId: string;
  currentCourtId: string;
  courts: { id: string; name: string }[];
}

// "Sometimes customer change their mind... rather play in further
// court" — same time slot, staff pick a different, currently-available
// court. Only shown pre-payment (see the booking detail page's own
// gating) — the server rejects it anyway once a Sale exists, but hiding
// it here avoids offering an action that would just fail.
export function SwitchCourtForm({ bookingId, currentCourtId, courts }: SwitchCourtFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const otherCourts = courts.filter((court) => court.id !== currentCourtId);
  const [newCourtId, setNewCourtId] = useState(otherCourts[0]?.id ?? "");

  if (otherCourts.length === 0) {
    return null;
  }

  function handleSubmit() {
    if (!newCourtId) return;
    startTransition(async () => {
      const result = await changeBookingCourtAction({ bookingId, newCourtId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Court switched.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="border-input rounded-md border px-2 py-1.5 text-sm"
        value={newCourtId}
        onChange={(event) => setNewCourtId(event.target.value)}
        disabled={isPending}
      >
        {otherCourts.map((court) => (
          <option key={court.id} value={court.id}>
            {court.name}
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending || !newCourtId}
        onClick={handleSubmit}
      >
        {isPending ? "Switching…" : "Switch court"}
      </Button>
    </div>
  );
}
