"use client";

import { useEffect, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { createPublicBookingAction, type PublicBookingCoachOption } from "@/actions/public-booking.actions";
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
import { PublicCoachAddOn } from "@/features/coaching/components/public-coach-add-on";
import { getCourtBookingWindow } from "@/lib/court-hours";
import { formatCurrency } from "@/lib/utils";
import type { CourtHoursSettings } from "@/features/cms/schemas/cms.schema";

// Presentation-only convenience list — no schema/service duration limit
// exists (services/booking/booking.service.ts's totalAmountCents is
// computed pro-rata from whatever startAt/endAt span is submitted).
// Hour-only: this business doesn't book in 30-minute increments, up to
// a reasonable 4-hour upper bound for a single-court booking.
const DURATIONS_MINUTES = [60, 120, 180, 240];

function formatDurationLabel(minutes: number): string {
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

// Hour-only start times — the native <input type="time"> showed three
// scrollable columns (hour/minute/AM-PM) and let a customer pick a
// minute this business doesn't support.
//
// Court/date-aware (found live: Court 1 closes 6 PM, but an earlier
// flat 7 AM-10 PM list let a customer pick 8 PM and then get a real
// server rejection — "OUTSIDE_OPERATING_HOURS" is genuinely enforced
// server-side in that case, so nothing ever double-books, but the
// dropdown itself was misleading). getCourtBookingWindow is the exact
// same pure function services/booking/booking.service.ts's server-side
// enforcement calls — same source of truth, not a second guess at it.
// The last valid START hour is closeMinutes MINUS the selected
// duration, so a longer booking correctly loses more trailing options
// than a 1-hour one would.
function getAvailableTimeOptions(
  courtHours: CourtHoursSettings,
  courtName: string | undefined,
  dateValue: string,
  durationMinutes: number,
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

interface PublicBookingFormCourt {
  id: string;
  name: string;
  hourlyRateCents: number | null;
}

interface PublicBookingFormValues {
  guestName: string;
  guestPhone: string;
  courtId: string;
  date: string;
  time: string;
  durationMinutes: string;
}

interface BookingConfirmation {
  bookingId: string;
  bookingReference: string;
  courtName: string;
  date: string;
  time: string;
  durationMinutes: number;
  guestName: string;
  // Already computed and persisted server-side (pro-rata) — see
  // services/booking/booking.service.ts's totalAmountCents.
  totalAmountCents: number;
  // Phase 8: true only when the owner-controlled GCash-prepayment switch
  // is on. Must not be silently ignored here — showing "Booking
  // confirmed... payment collected at the venue" for what's actually a
  // 30-minute hold waiting on GCash proof would tell a customer their
  // slot is secured when it isn't yet.
  requiresPayment: boolean;
  // Independent of requiresPayment above — offered whether this booking
  // landed CONFIRMED or as a hold, since attaching a coach never depends
  // on the court booking's payment state (see public-booking.actions.ts's
  // comment on this same field).
  availableCoaches: PublicBookingCoachOption[];
}

function toLocalDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface PublicBookingFormProps {
  courts: PublicBookingFormCourt[];
  courtHours: CourtHoursSettings;
  initialCourtId?: string;
  initialDate?: string;
  initialTime?: string;
  initialDurationMinutes?: string;
}

export function PublicBookingForm({
  courts,
  courtHours,
  initialCourtId,
  initialDate,
  initialTime,
  initialDurationMinutes,
}: PublicBookingFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);

  const validInitialDuration =
    initialDurationMinutes && DURATIONS_MINUTES.includes(Number(initialDurationMinutes))
      ? initialDurationMinutes
      : undefined;
  const initialCourtIdResolved = initialCourtId ?? courts[0]?.id ?? "";
  const initialDateResolved = initialDate ?? toLocalDateValue(new Date());
  const initialDurationResolved = validInitialDuration ?? "60";
  const initialCourtName = courts.find((court) => court.id === initialCourtIdResolved)?.name;
  const initialTimeOptions = getAvailableTimeOptions(
    courtHours,
    initialCourtName,
    initialDateResolved,
    Number(initialDurationResolved),
  );
  const validInitialTime = initialTime && initialTimeOptions.includes(initialTime) ? initialTime : undefined;

  const { control, register, handleSubmit, setValue } = useForm<PublicBookingFormValues>({
    defaultValues: {
      guestName: "",
      guestPhone: "",
      courtId: initialCourtIdResolved,
      date: initialDateResolved,
      time: validInitialTime ?? initialTimeOptions[0] ?? "",
      durationMinutes: initialDurationResolved,
    },
  });

  // Preview-only — mirrors booking.service.ts's own Math.round(hourlyRateCents
  // * durationHours) so the number shown here matches what the server will
  // actually charge, same shape as the staff booking form's own "Pricing
  // summary" preview. Never fed back into the submitted payload; the
  // server still computes and persists the real amount independently.
  const watchedCourtId = useWatch({ control, name: "courtId" });
  const watchedDate = useWatch({ control, name: "date" });
  const watchedTime = useWatch({ control, name: "time" });
  const watchedDurationMinutes = useWatch({ control, name: "durationMinutes" });
  const selectedCourt = courts.find((court) => court.id === watchedCourtId);
  const previewDurationHours = Number(watchedDurationMinutes) / 60;
  const previewTotalCents =
    selectedCourt?.hourlyRateCents != null && Number.isFinite(previewDurationHours)
      ? Math.round(selectedCourt.hourlyRateCents * previewDurationHours)
      : null;

  // Recomputed on every court/date/duration change — the same source of
  // truth server-side enforcement uses (see getAvailableTimeOptions's own
  // comment above). When the currently-selected time falls outside the
  // freshly computed set (e.g. switching from Court 3 to Court 1, or
  // picking a longer duration that no longer fits), snap to the first
  // still-valid option rather than silently leaving an invalid one
  // selected — same reasoning as the bug this whole fix closes.
  const availableTimeOptions = getAvailableTimeOptions(
    courtHours,
    selectedCourt?.name,
    watchedDate,
    Number(watchedDurationMinutes),
  );
  useEffect(() => {
    if (availableTimeOptions.length > 0 && !availableTimeOptions.includes(watchedTime)) {
      setValue("time", availableTimeOptions[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTimeOptions.join(","), watchedTime]);

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    startTransition(async () => {
      const result = await createPublicBookingAction({
        guestName: values.guestName,
        guestPhone: values.guestPhone,
        courtId: values.courtId,
        date: values.date,
        time: values.time,
        durationMinutes: Number(values.durationMinutes),
      });

      if (result.error || !result.bookingReference) {
        setServerError(result.error ?? "Something went wrong. Please try again.");
        return;
      }

      setConfirmation({
        bookingId: result.bookingId ?? "",
        bookingReference: result.bookingReference,
        courtName: courts.find((court) => court.id === values.courtId)?.name ?? "",
        date: values.date,
        time: values.time,
        durationMinutes: Number(values.durationMinutes),
        guestName: values.guestName,
        totalAmountCents: result.totalAmountCents ?? 0,
        requiresPayment: result.requiresPayment ?? false,
        availableCoaches: result.availableCoaches ?? [],
      });
    });
  });

  if (confirmation) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className={confirmation.requiresPayment ? undefined : "text-success"}>
            {confirmation.requiresPayment ? "Slot held — payment needed" : "Booking confirmed"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Reference</span>
            <span className="font-mono font-medium">{confirmation.bookingReference}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{confirmation.guestName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Court</span>
            <span className="font-medium">{confirmation.courtName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Date</span>
            <span className="font-medium">{confirmation.date}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Time</span>
            <span className="font-medium">{confirmation.time}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Duration</span>
            <span className="font-medium">{confirmation.durationMinutes} minutes</span>
          </div>
          <div className="flex justify-between border-t pt-3 text-base">
            <span className="font-medium">Total</span>
            <span className="font-semibold tabular-nums">{formatCurrency(confirmation.totalAmountCents)}</span>
          </div>
          {confirmation.requiresPayment ? (
            <p className="text-warning-foreground bg-warning/15 rounded-lg p-2 pt-2 text-xs">
              This slot is held for 30 minutes, not yet confirmed. Send your GCash payment and
              save your reference number — call us or visit the desk with it, and we&apos;ll get
              your booking verified. Save your reference and phone number to look this up later.
            </p>
          ) : (
            <p className="text-muted-foreground pt-2 text-xs">
              Save your reference and phone number — you can look up this booking anytime from the
              Booking Lookup page. Payment is collected at the venue.
            </p>
          )}

          {/* Offered regardless of requiresPayment above — a held slot
              can still have a coach attached before payment clears, same
              as coach-session.service.ts's createCoachSession itself
              never gating on Booking.status. */}
          <div className="border-t pt-3">
            <PublicCoachAddOn bookingId={confirmation.bookingId} availableCoaches={confirmation.availableCoaches} />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guestName">Name</Label>
        <Input id="guestName" {...register("guestName", { required: true })} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guestPhone">Phone number</Label>
        <Input id="guestPhone" type="tel" {...register("guestPhone", { required: true })} />
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
                  {(value: string) => courts.find((court) => court.id === value)?.name ?? "Select a court"}
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

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date">Date</Label>
          <Input id="date" type="date" {...register("date", { required: true })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="time">Time</Label>
          <Controller
            control={control}
            name="time"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={availableTimeOptions.length === 0}
              >
                <SelectTrigger id="time" className="w-full">
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
            )}
          />
          {availableTimeOptions.length === 0 && selectedCourt ? (
            <p className="text-muted-foreground text-xs">
              {selectedCourt.name} has no {formatDurationLabel(Number(watchedDurationMinutes)).toLowerCase()} slot
              available that day — try a shorter duration or another court.
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="durationMinutes">Duration</Label>
        <Controller
          control={control}
          name="durationMinutes"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="durationMinutes" className="w-full">
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
          )}
        />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Rate</span>
            <span className="font-medium tabular-nums">
              {selectedCourt?.hourlyRateCents != null
                ? `${formatCurrency(selectedCourt.hourlyRateCents)}/hr`
                : "—"}
            </span>
          </div>
          <div className="flex justify-between border-t pt-2 text-base">
            <span className="font-medium">Total</span>
            <span className="font-semibold tabular-nums">
              {previewTotalCents != null ? formatCurrency(previewTotalCents) : "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={isPending || courts.length === 0 || availableTimeOptions.length === 0}>
        {isPending ? "Booking…" : "Book Now"}
      </Button>
    </form>
  );
}
