"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { addPublicCoachToBookingAction, removePublicCoachFromBookingAction } from "@/actions/public-coaching.actions";
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
import { ContactFallbackLinks } from "@/features/bookings/components/contact-fallback-links";
import { formatCurrency } from "@/lib/utils";

export interface PublicCoachAddOnConfirmed {
  coachName: string;
  priceCents: number;
}

interface PublicCoachAddOnProps {
  bookingId: string;
  availableCoaches: PublicBookingCoachOption[];
  // Only affects the confirmed-state copy below — "pay at the venue" is
  // only actually true when this booking never required GCash prepayment
  // at all (see coach-session.service.ts's ordering-guard comment for why
  // requiresPayment, not booking status, is the wrong signal — this prop
  // mirrors it for display purposes only).
  requiresPayment: boolean;
  // Once true, adding/removing is locked out here AND rejected server-
  // side (coach-session.service.ts's proof-row guard) — the customer
  // already committed to an amount, changing the coach now would make it
  // wrong with no way to reconcile it.
  hasSubmittedProof: boolean;
  contactPhone: string;
  contactFacebookUrl: string;
  // Reports the current coach session (or null once removed) so the
  // parent can recompute the amount due and show a court/coaching
  // breakdown — see public-booking-form.tsx.
  onCoachSessionChange: (session: PublicCoachAddOnConfirmed | null) => void;
}

// Optional add-on shown on the booking confirmation screen, not a step
// in the booking form itself — a court booking with no coach is the
// normal case and stays a single-step submit either way (Gate 3 review).
export function PublicCoachAddOn({
  bookingId,
  availableCoaches,
  requiresPayment,
  hasSubmittedProof,
  contactPhone,
  contactFacebookUrl,
  onCoachSessionChange,
}: PublicCoachAddOnProps) {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [coachId, setCoachId] = useState("");
  const [groupSize, setGroupSize] = useState("");
  const [confirmed, setConfirmed] = useState<PublicCoachAddOnConfirmed | null>(null);

  const selectedCoach = availableCoaches.find((coach) => coach.id === coachId);
  const groupSizeOptions = useMemo(
    () => (selectedCoach ? selectedCoach.rates.map((rate) => rate.groupSize).sort((a, b) => a - b) : []),
    [selectedCoach],
  );
  const selectedRate = selectedCoach?.rates.find((rate) => rate.groupSize === Number(groupSize));

  if (hasSubmittedProof) {
    return (
      <div className="bg-muted/40 rounded-lg border p-4 text-sm">
        {confirmed ? (
          <>
            <p className="font-medium">Coach</p>
            <p className="text-muted-foreground mt-1">
              {confirmed.coachName} · {formatCurrency(confirmed.priceCents)} — included in your total, paid via
              GCash.
            </p>
          </>
        ) : (
          <>
            <p className="font-medium">Add a coach</p>
            <p className="text-muted-foreground mt-1">
              Payment has already been submitted for this booking, so a coach can&apos;t be added here anymore.
              {contactPhone || contactFacebookUrl ? (
                <>
                  {" "}
                  Please <ContactFallbackLinks phone={contactPhone} facebookUrl={contactFacebookUrl} /> to add one.
                </>
              ) : (
                " Please contact us to add one."
              )}
            </p>
          </>
        )}
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="border-success/40 bg-success/10 rounded-lg border p-4 text-sm">
        <p className="font-medium">Coach added</p>
        <p className="text-muted-foreground mt-1">
          {confirmed.coachName} · {formatCurrency(confirmed.priceCents)} —{" "}
          {requiresPayment
            ? "included in your total below, pay via GCash."
            : "pay at the venue, same as your court."}
        </p>
        {serverError ? (
          <p className="text-destructive mt-2 text-xs" role="alert">
            {serverError}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={isPending}
          onClick={() => {
            setServerError(null);
            startTransition(async () => {
              const result = await removePublicCoachFromBookingAction({ bookingId });
              if (result.error) {
                setServerError(result.error);
                return;
              }
              setConfirmed(null);
              onCoachSessionChange(null);
            });
          }}
        >
          {isPending ? "Removing…" : "Remove coach"}
        </Button>
      </div>
    );
  }

  if (availableCoaches.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No coaches available for this time.{" "}
        <Link href="/coaches/availability" className="underline">
          See coach availability
        </Link>{" "}
        for a time that works.
        {contactPhone || contactFacebookUrl ? (
          <>
            {" "}
            Want one anyway?{" "}
            <ContactFallbackLinks phone={contactPhone} facebookUrl={contactFacebookUrl} />.
          </>
        ) : null}
      </p>
    );
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
      // The actual amount charged (result.priceCents) is what drives the
      // total below, not our own local rate lookup — a stale client-side
      // rate can't ever under/overstate the real GCash amount due.
      const next = {
        coachName: selectedCoach?.name ?? "Coach",
        priceCents: result.priceCents ?? selectedRate?.priceCents ?? 0,
      };
      setConfirmed(next);
      onCoachSessionChange(next);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">
        Optional — add a coach for this session.{" "}
        <Link href="/coaches/availability" className="underline">
          See coach availability
        </Link>
        .
      </p>

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
