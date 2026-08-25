"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { changeBookingSlotAction } from "@/actions/booking.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface MoveBookingFormProps {
  bookingId: string;
  currentCourtId: string;
  currentStartAt: Date;
  currentEndAt: Date;
  courts: { id: string; name: string }[];
  isPaid: boolean;
}

// Owner request (2026-08-25): "can we make the staff change the court even
// if it's booked thru website. also the time if possible", with the rule
// "once it's already paid, make sure the changes can only be different
// time slot diff court but same number of hours", and "not the past".
//
// Replaces the old SwitchCourtForm, which was court-only and hidden once a
// Sale existed. It is now shown for paid bookings too — the website ones
// are precisely the ones staff needed to move. On a paid booking the
// duration is LOCKED: the end time is derived from the start, so the
// length physically cannot be edited rather than being rejected after the
// fact. The service enforces the same rule regardless.
function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function MoveBookingForm({
  bookingId,
  currentCourtId,
  currentStartAt,
  currentEndAt,
  courts,
  isPaid,
}: MoveBookingFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [courtId, setCourtId] = useState(currentCourtId);
  const [startValue, setStartValue] = useState(toLocalInputValue(currentStartAt));
  const [endValue, setEndValue] = useState(toLocalInputValue(currentEndAt));

  const durationMs = currentEndAt.getTime() - currentStartAt.getTime();
  const durationHours = Math.round((durationMs / 3_600_000) * 100) / 100;

  // On a paid booking the length is fixed, so the end follows the start
  // automatically and its input is read-only.
  function handleStartChange(value: string) {
    setStartValue(value);
    if (!isPaid || !value) {
      return;
    }
    const start = new Date(value);
    if (Number.isNaN(start.getTime())) {
      return;
    }
    setEndValue(toLocalInputValue(new Date(start.getTime() + durationMs)));
  }

  const startChanged = startValue !== toLocalInputValue(currentStartAt);
  const endChanged = endValue !== toLocalInputValue(currentEndAt);
  const courtChanged = courtId !== currentCourtId;
  const canSubmit = courtChanged || startChanged || endChanged;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    const start = new Date(startValue);
    const end = new Date(endValue);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      toast.error("Enter a valid start and end time.");
      return;
    }

    startTransition(async () => {
      const result = await changeBookingSlotAction({
        bookingId,
        newCourtId: courtChanged ? courtId : undefined,
        newStartAt: startChanged || endChanged ? start : undefined,
        newEndAt: startChanged || endChanged ? end : undefined,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Booking moved.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="moveCourt">Court</Label>
          <select
            id="moveCourt"
            className="border-input rounded-md border px-2 py-1.5 text-sm"
            value={courtId}
            onChange={(event) => setCourtId(event.target.value)}
            disabled={isPending}
          >
            {courts.map((court) => (
              <option key={court.id} value={court.id}>
                {court.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="moveStart">Starts</Label>
          <Input
            id="moveStart"
            type="datetime-local"
            value={startValue}
            onChange={(event) => handleStartChange(event.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="moveEnd">Ends</Label>
          <Input
            id="moveEnd"
            type="datetime-local"
            value={endValue}
            onChange={(event) => setEndValue(event.target.value)}
            disabled={isPending || isPaid}
            readOnly={isPaid}
          />
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        {isPaid
          ? `Already paid — it can move to any free court or time, but stays ${durationHours}h. The end time follows the start.`
          : "Move this booking to a different court, time, or both."}
      </p>

      <Button type="submit" size="sm" variant="outline" disabled={isPending || !canSubmit} className="w-fit">
        {isPending ? "Moving…" : "Move booking"}
      </Button>
    </form>
  );
}
