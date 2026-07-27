"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
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

// First name of a "First Last" (or "First" / email-fallback) label —
// matching goes off this leading token only, per spec ("j" -> J names).
function firstToken(label: string): string {
  return label.trim().split(/\s+/)[0] ?? "";
}

// Search-as-you-type replacement for the old "every player in a
// scrollable dropdown" Select. One field does double duty: matching a
// real player attaches them (same as the old dropdown's selection);
// typing text that matches nobody is used directly as the guest name
// (the same guest-booking path that already existed, just reached by
// typing instead of picking a special "No player" option) — so this
// also absorbs what used to be a separate always-visible "Guest name"
// input, since keeping both would leave two fields able to disagree
// about who's actually attached to the booking.
function PlayerCombobox({
  players,
  selectedPlayerId,
  guestName,
  onSelectPlayer,
  onGuestNameChange,
}: {
  players: BookingFormPlayer[];
  selectedPlayerId: string | null;
  guestName: string;
  onSelectPlayer: (player: BookingFormPlayer) => void;
  onGuestNameChange: (name: string) => void;
}) {
  const selectedPlayer = selectedPlayerId ? players.find((player) => player.id === selectedPlayerId) : null;
  const displayValue = selectedPlayer ? selectedPlayer.label : guestName;
  const [isOpen, setIsOpen] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = displayValue.trim();
  const matches = query
    ? players.filter((player) => firstToken(player.label).toLowerCase().startsWith(query.toLowerCase())).slice(0, 8)
    : [];

  function handleChange(text: string) {
    // Any edit invalidates a prior selection — the text no longer
    // necessarily names that player, so it reverts to guest-name mode
    // until (if ever) it matches and gets picked again.
    onGuestNameChange(text);
    setIsOpen(text.trim().length > 0);
  }

  function handlePick(player: BookingFormPlayer) {
    onSelectPlayer(player);
    setIsOpen(false);
  }

  return (
    <div className="relative">
      <Input
        id="playerId"
        value={displayValue}
        placeholder="Type a name — search players or enter a guest name"
        onChange={(event) => handleChange(event.target.value)}
        onFocus={() => setIsOpen(query.length > 0 && matches.length > 0)}
        onBlur={() => {
          // Let a click on an option register before the list closes.
          blurTimeout.current = setTimeout(() => setIsOpen(false), 150);
        }}
        autoComplete="off"
      />
      {isOpen && matches.length > 0 ? (
        <div
          className="bg-popover text-popover-foreground ring-foreground/10 absolute top-full z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg shadow-md ring-1"
          onMouseDown={(event) => {
            // Fires before the input's onBlur — cancel the pending close
            // so the click below actually lands on an option.
            event.preventDefault();
            if (blurTimeout.current) clearTimeout(blurTimeout.current);
          }}
        >
          {matches.map((player) => (
            <button
              key={player.id}
              type="button"
              onClick={() => handlePick(player)}
              className="hover:bg-accent block w-full px-3 py-2 text-left text-sm"
            >
              {player.label}
            </button>
          ))}
        </div>
      ) : null}
      {!selectedPlayer && guestName.trim() ? (
        <p className="text-muted-foreground mt-1 text-xs">
          No matching player — &quot;{guestName.trim()}&quot; will be booked as a guest.
        </p>
      ) : null}
    </div>
  );
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
        <PlayerCombobox
          players={players}
          selectedPlayerId={watchedPlayerId === NO_PLAYER_VALUE ? null : watchedPlayerId}
          guestName={watchedGuestName}
          onSelectPlayer={(player) => {
            setValue("playerId", player.id);
            setValue("guestName", "");
          }}
          onGuestNameChange={(name) => {
            setValue("playerId", NO_PLAYER_VALUE);
            setValue("guestName", name);
          }}
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
