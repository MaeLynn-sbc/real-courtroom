"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createBookingSchema } from "@/features/bookings/schemas/booking.schema";
import { PlayerSearchCombobox } from "@/features/players/components/player-search-combobox";
import { formatCurrency } from "@/lib/utils";

// Matches the public booking form's own DURATIONS_MINUTES list —
// hour-only, this business doesn't book in 30-minute increments.
const WALK_IN_DURATIONS_MINUTES = [60, 120, 180, 240];

function formatDurationLabel(minutes: number): string {
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
const NO_PLAYER_VALUE = "__none__";

interface BookingFormCourt {
  id: string;
  name: string;
  hourlyRateCents: number | null;
}

interface BookingFormPlayer {
  id: string;
  label: string;
}

interface BookingFormPaymentMethod {
  id: string;
  label: string;
}

interface BookingFormValues {
  courtId: string;
  playerId: string;
  guestName: string;
  guestPhone: string;
  notes: string;
  startAt: string;
  endAt: string;
  paymentMethodId: string;
}

interface BookingFormProps {
  courts: BookingFormCourt[];
  players: BookingFormPlayer[];
  paymentMethods: BookingFormPaymentMethod[];
}

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function BookingForm({ courts, players, paymentMethods }: BookingFormProps) {
  const router = useRouter();
  const [isWalkIn, setIsWalkIn] = useState(true);
  const [walkInDuration, setWalkInDuration] = useState(60);
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
      startAt: toLocalInputValue(new Date()),
      endAt: toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)),
      paymentMethodId: paymentMethods[0]?.id ?? "",
    },
  });

  // Preview-only — mirrors booking.service.ts's Math.round(hourlyRateCents *
  // durationHours) so the number shown here matches what the server will
  // actually charge, but this never feeds back into the submitted payload;
  // the server still computes and persists the real amount independently.
  const watchedCourtId = useWatch({ control, name: "courtId" });
  const watchedStartAt = useWatch({ control, name: "startAt" });
  const watchedEndAt = useWatch({ control, name: "endAt" });
  const watchedPlayerId = useWatch({ control, name: "playerId" });
  const watchedGuestName = useWatch({ control, name: "guestName" });
  const selectedCourt = courts.find((court) => court.id === watchedCourtId);
  const durationHours = isWalkIn
    ? walkInDuration / 60
    : Math.max(
        0,
        (new Date(watchedEndAt).getTime() - new Date(watchedStartAt).getTime()) / (1000 * 60 * 60),
      );
  const previewTotalCents =
    selectedCourt?.hourlyRateCents != null && Number.isFinite(durationHours)
      ? Math.round(selectedCourt.hourlyRateCents * durationHours)
      : 0;

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const now = new Date();
    const startAt = isWalkIn ? now : new Date(values.startAt);
    const endAt = isWalkIn
      ? new Date(now.getTime() + walkInDuration * 60 * 1000)
      : new Date(values.endAt);

    const parsed = createBookingSchema.safeParse({
      courtId: values.courtId,
      type: isWalkIn ? "WALK_IN" : "HOURLY",
      startAt,
      endAt,
      playerId: values.playerId === NO_PLAYER_VALUE ? undefined : values.playerId,
      guestName: values.guestName.trim() || undefined,
      guestPhone: values.guestPhone.trim() || undefined,
      notes: values.notes.trim() || undefined,
      paymentMethodId: values.paymentMethodId,
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
      <div className="flex items-center gap-3">
        <Switch id="isWalkIn" checked={isWalkIn} onCheckedChange={setIsWalkIn} />
        <Label htmlFor="isWalkIn">Walk-in (starts now)</Label>
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

      {isWalkIn ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="walkInDuration">Duration</Label>
          <Select
            value={String(walkInDuration)}
            onValueChange={(value) => setWalkInDuration(Number(value))}
          >
            <SelectTrigger id="walkInDuration" className="w-full">
              <SelectValue>{(value: string) => formatDurationLabel(Number(value))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {WALK_IN_DURATIONS_MINUTES.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {formatDurationLabel(minutes)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="startAt">Starts</Label>
            <Input id="startAt" type="datetime-local" {...register("startAt")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="endAt">Ends</Label>
            <Input id="endAt" type="datetime-local" {...register("endAt")} />
          </div>
        </>
      )}

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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="paymentMethodId">Payment method</Label>
        <Controller
          control={control}
          name="paymentMethodId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="paymentMethodId" className="w-full">
                <SelectValue placeholder="Select a payment method">
                  {(value: string) =>
                    paymentMethods.find((method) => method.id === value)?.label ??
                    "Select a payment method"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {paymentMethods.map((method) => (
                  <SelectItem key={method.id} value={method.id}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

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
            <span className="font-medium tabular-nums">{durationHours.toFixed(1)} hr</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Rate</span>
            <span className="font-medium tabular-nums">
              {selectedCourt?.hourlyRateCents != null
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

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create booking"}
      </Button>
    </form>
  );
}
