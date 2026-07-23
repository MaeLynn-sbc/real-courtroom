"use client";

import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";

import { createPublicBookingAction } from "@/actions/public-booking.actions";
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

const DURATIONS_MINUTES = [30, 60, 90, 120];

interface PublicBookingFormCourt {
  id: string;
  name: string;
}

interface PublicBookingFormValues {
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  courtId: string;
  date: string;
  time: string;
  durationMinutes: string;
}

interface BookingConfirmation {
  bookingReference: string;
  courtName: string;
  date: string;
  time: string;
  durationMinutes: number;
  guestName: string;
}

function toLocalDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function PublicBookingForm({ courts }: { courts: PublicBookingFormCourt[] }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);

  const { control, register, handleSubmit } = useForm<PublicBookingFormValues>({
    defaultValues: {
      guestName: "",
      guestPhone: "",
      guestEmail: "",
      courtId: courts[0]?.id ?? "",
      date: toLocalDateValue(new Date()),
      time: "09:00",
      durationMinutes: "60",
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    startTransition(async () => {
      const result = await createPublicBookingAction({
        guestName: values.guestName,
        guestPhone: values.guestPhone,
        guestEmail: values.guestEmail || undefined,
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
        bookingReference: result.bookingReference,
        courtName: courts.find((court) => court.id === values.courtId)?.name ?? "",
        date: values.date,
        time: values.time,
        durationMinutes: Number(values.durationMinutes),
        guestName: values.guestName,
      });
    });
  });

  if (confirmation) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="text-success">Booking confirmed</CardTitle>
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
          <p className="text-muted-foreground pt-2 text-xs">
            Save your reference and phone number — you can look up this booking anytime from the
            Booking Lookup page. Payment is collected at the venue.
          </p>
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
        <Label htmlFor="guestEmail">Email (optional)</Label>
        <Input id="guestEmail" type="email" {...register("guestEmail")} />
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
