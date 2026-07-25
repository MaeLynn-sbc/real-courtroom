"use client";

import { useMemo, useState, useTransition } from "react";

import { addPublicCoachToBookingAction } from "@/actions/public-coaching.actions";
import type { PublicBookingCoachOption } from "@/actions/public-booking.actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";

interface PublicCoachAddOnProps {
  bookingId: string;
  availableCoaches: PublicBookingCoachOption[];
}

// Optional add-on shown on the booking confirmation screen, not a step
// in the booking form itself — a court booking with no coach is the
// normal case and stays a single-step submit either way (Gate 3 review).
export function PublicCoachAddOn({ bookingId, availableCoaches }: PublicCoachAddOnProps) {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [coachId, setCoachId] = useState("");
  const [groupSize, setGroupSize] = useState("");
  const [confirmed, setConfirmed] = useState<{ coachName: string; priceCents: number } | null>(null);

  const selectedCoach = availableCoaches.find((coach) => coach.id === coachId);
  const groupSizeOptions = useMemo(
    () => (selectedCoach ? selectedCoach.rates.map((rate) => rate.groupSize).sort((a, b) => a - b) : []),
    [selectedCoach],
  );
  const selectedRate = selectedCoach?.rates.find((rate) => rate.groupSize === Number(groupSize));

  if (confirmed) {
    return (
      <div className="border-success/40 bg-success/10 rounded-lg border p-4 text-sm">
        <p className="font-medium">Coach added</p>
        <p className="text-muted-foreground mt-1">
          {confirmed.coachName} · {formatCurrency(confirmed.priceCents)} — pay at the venue, same as
          your court.
        </p>
      </div>
    );
  }

  if (availableCoaches.length === 0) {
    return <p className="text-muted-foreground text-sm">No coaches available for this time.</p>;
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    if (!coachId || !groupSize) {
      setServerError("Select a coach and a group size.");
      return;
    }

    startTransition(async () => {
      const result = await addPublicCoachToBookingAction({
        bookingId,
        coachId,
        groupSize: Number(groupSize),
      });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      setConfirmed({
        coachName: selectedCoach?.name ?? "Coach",
        priceCents: selectedRate?.priceCents ?? 0,
      });
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">Optional — add a coach for this session.</p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="publicCoachId">Coach</Label>
        <Select
          value={coachId}
          onValueChange={(value) => {
            setCoachId(value ?? "");
            setGroupSize("");
          }}
        >
          <SelectTrigger id="publicCoachId" className="w-full">
            <SelectValue placeholder="No coach">
              {(value: string) => availableCoaches.find((coach) => coach.id === value)?.name ?? "No coach"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {availableCoaches.map((coach) => (
              <SelectItem key={coach.id} value={coach.id}>
                {coach.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {coachId ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="publicGroupSize">Group size</Label>
          <Select value={groupSize} onValueChange={(value) => setGroupSize(value ?? "")}>
            <SelectTrigger id="publicGroupSize" className="w-full">
              <SelectValue placeholder="Select group size">
                {(value: string) => (value ? `${value} ${Number(value) === 1 ? "person" : "people"}` : "Select group size")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {groupSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} {size === 1 ? "person" : "people"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedRate ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Rate: </span>
              <span className="font-medium">{formatCurrency(selectedRate.priceCents)}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}

      <Button type="submit" variant="outline" size="sm" disabled={isPending || !coachId || !groupSize} className="self-start">
        {isPending ? "Adding…" : "Add coach"}
      </Button>
    </form>
  );
}
