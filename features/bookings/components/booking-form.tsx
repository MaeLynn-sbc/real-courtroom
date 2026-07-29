"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { createBookingAction } from "@/actions/booking.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createBookingSchema } from "@/features/bookings/schemas/booking.schema";
import { PlayerSearchCombobox } from "@/features/players/components/player-search-combobox";
import { useLiveNow } from "@/hooks/use-live-now";
import { getCourtBookingWindow, isHourInThePast } from "@/lib/court-hours";
import { formatCurrency } from "@/lib/utils";
import type { CourtHoursSettings } from "@/features/cms/schemas/cms.schema";

// STAFF-ONLY: 30 minutes, front-desk only — someone who just wants a
// quick half-hour, priced flat (services/booking/booking.service.ts's
// createBooking special-cases exactly-30-minute bookings, bypassing
// the hourly rate formula). Deliberately NOT added to the public
// /book form's own identical-looking list
// (public-booking-form.tsx's own DURATIONS_MINUTES stays [60,120,180,240]
// — the two lists are independent constants, not shared, precisely so
// this doesn't leak into online booking).
const DURATIONS_MINUTES = [30, 60, 120, 180, 240];

function formatDurationLabel(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minutes`;
  }
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

// Reported live: Advance booking mode used two raw <input
// type="datetime-local"> fields — minute-level precision on a business
// that only books in whole hours, typed by hand at both ends (two
// chances to mistype), with no bound tying either one to the court's
// real operating hours. Replaced with the exact Date + Start time +
// Duration shape the public /book form already uses successfully —
// getAvailableTimeOptions/formatTimeLabel below are that form's own
// functions, duplicated rather than imported (same "small pure helper,
// not a shared module" precedent this file already followed for
// DURATIONS_MINUTES). See public-booking-form.tsx's own copy for the
// full reasoning on why each piece is shaped the way it is
// (court/date-aware bounds via getCourtBookingWindow, past-hour
// filtering via isHourInThePast — the exact same source of truth the
// server-side OUTSIDE_OPERATING_HOURS check and the homepage grid both
// already use, so nothing here can disagree with what the server will
// actually accept).
//
// No arbitrary-end-time escape hatch: checked before building this —
// createBookingSchema/booking.service.ts place no hour-alignment or
// duration-limit constraint of their own (the flexibility exists
// server-side by design), but the only two real callers (this form and
// the public one) both already constrain themselves to this same fixed
// 1-4 hour list, and the public form has run as the sole public
// booking path with this exact constraint with no reported need for
// anything wider. If staff turn out to need an odd-length booking this
// list can't express (e.g. a 5-hour tournament block), that's a real
// gap worth a deliberate follow-up — not silently reintroduced here as
// a "just in case" field.
function getAvailableTimeOptions(
  courtHours: CourtHoursSettings,
  courtName: string | undefined,
  dateValue: string,
  durationMinutes: number,
  now: number,
): string[] {
  if (!courtName || !dateValue) {
    return [];
  }
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return [];
  }
  const window = getCourtBookingWindow(courtHours, courtName, date);
  const lastStartMinutes = window.closeMinutes - durationMinutes;

  const options: string[] = [];
  for (let minutes = window.openMinutes; minutes <= lastStartMinutes; minutes += 60) {
    const hours = Math.floor(minutes / 60);
    const slotStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, 0);
    if (isHourInThePast(slotStart, now)) {
      continue;
    }
    options.push(`${String(hours).padStart(2, "0")}:00`);
  }
  return options;
}

function formatTimeLabel(value: string): string {
  const [hoursStr] = value.split(":");
  const hours = Number(hoursStr);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:00 ${period}`;
}

const NO_PLAYER_VALUE = "__none__";

interface BookingFormCourt {
  id: string;
  name: string;
  hourlyRateCents: number | null;
  // Flat, per-court price for the 30-minute walk-in option — owner-
  // editable on the Courts screen (features/courts/components/
  // court-form.tsx), not derived from hourlyRateCents. Only ever used
  // for a preview here; the server computes and persists the real
  // amount independently, same as every other price shown on this
  // form.
  shortSessionPriceCents: number;
}

interface BookingFormPlayer {
  id: string;
  label: string;
}

interface BookingFormValues {
  courtId: string;
  playerId: string;
  guestName: string;
  guestPhone: string;
  notes: string;
}

interface BookingFormProps {
  courts: BookingFormCourt[];
  players: BookingFormPlayer[];
  courtHours: CourtHoursSettings;
}

function toLocalDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function BookingForm({ courts, players, courtHours }: BookingFormProps) {
  const router = useRouter();
  const [isWalkIn, setIsWalkIn] = useState(true);
  // Shared by both modes — walk-in's own duration select already only
  // ever fed local state, not the form; advance mode now works the
  // same way instead of introducing a second, parallel piece of state.
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [advanceDate, setAdvanceDate] = useState(() => toLocalDateValue(new Date()));
  const [advanceTime, setAdvanceTime] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<BookingFormValues>({
    defaultValues: {
      courtId: courts[0]?.id ?? "",
      playerId: NO_PLAYER_VALUE,
      guestName: "",
      guestPhone: "",
      notes: "",
    },
  });

  const watchedCourtId = useWatch({ control, name: "courtId" });
  const watchedPlayerId = useWatch({ control, name: "playerId" });
  const watchedGuestName = useWatch({ control, name: "guestName" });
  const selectedCourt = courts.find((court) => court.id === watchedCourtId);

  // useLiveNow, not an inline Date.now() — a front-desk tab realistically
  // stays open for a whole shift with no interaction, and nothing else
  // here re-renders on its own as wall-clock time passes. Without a live
  // clock, an hour that was still in the future when the page loaded
  // stays selectable indefinitely, however far past it actually gets.
  const now = useLiveNow();

  // Recomputed on every court/date/duration change, same source of
  // truth (and same re-snap-when-invalid behavior) as the public
  // form's own identical effect — see that file's comment for why.
  const availableTimeOptions = isWalkIn
    ? []
    : getAvailableTimeOptions(courtHours, selectedCourt?.name, advanceDate, durationMinutes, now);
  useEffect(() => {
    if (!isWalkIn && availableTimeOptions.length > 0 && !availableTimeOptions.includes(advanceTime)) {
      setAdvanceTime(availableTimeOptions[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWalkIn, availableTimeOptions.join(","), advanceTime]);

  // Preview-only — mirrors booking.service.ts's own pricing exactly,
  // including the 30-minute flat-price special case, so the number
  // shown here matches what the server will actually charge. Never fed
  // back into the submitted payload; the server computes and persists
  // the real amount independently.
  const durationHours = durationMinutes / 60;
  const previewTotalCents =
    durationMinutes === 30
      ? (selectedCourt?.shortSessionPriceCents ?? 0)
      : selectedCourt?.hourlyRateCents != null
        ? Math.round(selectedCourt.hourlyRateCents * durationHours)
        : 0;

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const now = new Date();
    let startAt: Date;
    if (isWalkIn) {
      startAt = now;
    } else {
      const [year, month, day] = advanceDate.split("-").map(Number);
      const [hours] = advanceTime.split(":").map(Number);
      startAt = new Date(year, month - 1, day, hours, 0);
    }
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

    const parsed = createBookingSchema.safeParse({
      courtId: values.courtId,
      type: isWalkIn ? "WALK_IN" : "HOURLY",
      startAt,
      endAt,
      playerId: values.playerId === NO_PLAYER_VALUE ? undefined : values.playerId,
      guestName: values.guestName.trim() || undefined,
      guestPhone: values.guestPhone.trim() || undefined,
      notes: values.notes.trim() || undefined,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid booking details.");
      return;
    }

    startTransition(async () => {
      const result = await createBookingAction(parsed.data);
      if (result.error || !result.bookingId) {
        const message = result.error ?? "Something went wrong.";
        setServerError(message);
        toast.error(message);
        return;
      }
      toast.success("Booking created.");
      router.push(`/dashboard/bookings/${result.bookingId}`);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Booking type</Label>
        {/* Two explicit options rather than a single unlabeled switch —
            found live: staff had no visual hint the "off" state
            contained real date/time fields (booking-form.tsx used to
            just silently swap sections), so advance bookings were
            effectively undiscoverable. Default stays walk-in (owner
            decision — more common at the desk). */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant={isWalkIn ? "default" : "outline"}
            onClick={() => setIsWalkIn(true)}
          >
            Walk-in (starts now)
          </Button>
          <Button
            type="button"
            size="sm"
            variant={!isWalkIn ? "default" : "outline"}
            onClick={() => setIsWalkIn(false)}
          >
            Advance booking
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="courtId">Court</Label>
        <Controller
          control={control}
          name="courtId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="courtId" className="w-full">
                <SelectValue placeholder="Select a court">
                  {(value: string) =>
                    courts.find((court) => court.id === value)?.name ?? "Select a court"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {courts.map((court) => (
                  <SelectItem key={court.id} value={court.id}>
                    {court.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {!isWalkIn ? (
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="advanceDate">Date</Label>
            <Input
              id="advanceDate"
              type="date"
              value={advanceDate}
              onChange={(event) => setAdvanceDate(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="advanceTime">Time</Label>
            <Select
              value={advanceTime}
              onValueChange={(value) => value && setAdvanceTime(value)}
              disabled={availableTimeOptions.length === 0}
            >
              <SelectTrigger id="advanceTime" className="w-full">
                <SelectValue placeholder="No times available">
                  {(value: string) => (value ? formatTimeLabel(value) : "No times available")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {availableTimeOptions.map((time) => (
                  <SelectItem key={time} value={time}>
                    {formatTimeLabel(time)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableTimeOptions.length === 0 && selectedCourt ? (
              <p className="text-muted-foreground text-xs">
                {selectedCourt.name} has no {formatDurationLabel(durationMinutes).toLowerCase()} slot available
                that day — try a shorter duration, another court, or another date.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="duration">Duration</Label>
        <Select value={String(durationMinutes)} onValueChange={(value) => value && setDurationMinutes(Number(value))}>
          <SelectTrigger id="duration" className="w-full">
            <SelectValue>{(value: string) => formatDurationLabel(Number(value))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DURATIONS_MINUTES.map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {formatDurationLabel(minutes)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="playerId">Player</Label>
        <PlayerSearchCombobox
          id="playerId"
          players={players}
          selectedPlayerId={watchedPlayerId === NO_PLAYER_VALUE ? null : watchedPlayerId}
          text={watchedGuestName}
          placeholder="Type a name — search players or enter a guest name"
          onSelectPlayer={(player) => {
            setValue("playerId", player.id);
            setValue("guestName", "");
          }}
          onTextChange={(name) => {
            setValue("playerId", NO_PLAYER_VALUE);
            setValue("guestName", name);
          }}
          noMatchHint={(text) => `No matching player — "${text}" will be booked as a guest.`}
        />
        {errors.guestName ? (
          <p className="text-destructive text-sm">{errors.guestName.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guestPhone">Guest phone</Label>
        <Input id="guestPhone" {...register("guestPhone")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" rows={3} {...register("notes")} />
      </div>

      {/* Settle-bill (pay-at-venue gap fix): no payment method field here
          anymore — the customer's actual payment method isn't known
          until they actually pay, which may be after this booking is
          created. This booking is created unpaid; the "Settle bill"
          action on the booking detail page records payment later, once
          it's actually known. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pricing summary</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Court</span>
            <span className="font-medium">{selectedCourt?.name ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Duration</span>
            <span className="font-medium tabular-nums">{formatDurationLabel(durationMinutes)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Rate</span>
            <span className="font-medium tabular-nums">
              {durationMinutes === 30
                ? "Flat rate"
                : selectedCourt?.hourlyRateCents != null
                  ? `${formatCurrency(selectedCourt.hourlyRateCents)}/hr`
                  : "—"}
            </span>
          </div>
          <div className="flex justify-between border-t pt-2 text-base">
            <span className="font-medium">Estimated total</span>
            <span className="font-semibold tabular-nums">{formatCurrency(previewTotalCents)}</span>
          </div>
        </CardContent>
      </Card>

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending || (!isWalkIn && availableTimeOptions.length === 0)}>
        {isPending ? "Creating…" : "Create booking"}
      </Button>
    </form>
  );
}
