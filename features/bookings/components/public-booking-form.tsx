"use client";

import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";

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

// Presentation-only convenience list — no schema/service duration limit
// exists (services/booking/booking.service.ts's totalAmountCents is
// computed pro-rata from whatever startAt/endAt span is submitted).
// Extended from the original [30, 60, 90, 120] cap, which under-
// represented what the booking flow already supports end-to-end;
// uniform 30-minute increments up to 4 hours, a reasonable upper bound
// for a single-court booking (private events/extended practice) without
// offering an unrealistically long single slot.
const DURATIONS_MINUTES = [30, 60, 90, 120, 150, 180, 210, 240];

interface PublicBookingFormCourt {
  id: string;
  name: string;
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
  initialCourtId?: string;
  initialDate?: string;
  initialTime?: string;
  initialDurationMinutes?: string;
}

export function PublicBookingForm({
  courts,
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

  const { control, register, handleSubmit } = useForm<PublicBookingFormValues>({
    defaultValues: {
      guestName: "",
      guestPhone: "",
      courtId: initialCourtId ?? courts[0]?.id ?? "",
      date: initialDate ?? toLocalDateValue(new Date()),
      time: initialTime ?? "09:00",
      durationMinutes: validInitialDuration ?? "60",
    },
  });

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
          <Input id="time" type="time" {...register("time", { required: true })} />
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
                <SelectValue>{(value: string) => `${value} minutes`}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DURATIONS_MINUTES.map((minutes) => (
                  <SelectItem key={minutes} value={String(minutes)}>
                    {minutes} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={isPending || courts.length === 0}>
        {isPending ? "Booking…" : "Book Now"}
      </Button>
    </form>
  );
}
