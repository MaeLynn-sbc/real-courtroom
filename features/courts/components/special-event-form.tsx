"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { scheduleSpecialEventAction } from "@/actions/court.actions";
import { Button } from "@/components/ui/button";
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
import { specialEventSchema } from "@/features/courts/schemas/court.schema";

type BlockKind = "SPECIAL_EVENT" | "OPEN_PLAY";

interface SpecialEventFormCourt {
  id: string;
  name: string;
}

interface SpecialEventFormProps {
  courts: SpecialEventFormCourt[];
}

interface EventSlot {
  id: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInputValue(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Rounds up to the next 30-minute mark so the default "Starts" value is
// never in the past by the time staff actually submit the form.
function roundUpToNextHalfHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  const minutes = rounded.getMinutes();
  const add = minutes % 30 === 0 ? 30 : 30 - (minutes % 30);
  rounded.setMinutes(minutes + add);
  return rounded;
}

function makeDefaultSlot(): EventSlot {
  const start = roundUpToNextHalfHour(new Date());
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    id: crypto.randomUUID(),
    startDate: toDateInputValue(start),
    startTime: toTimeInputValue(start),
    endDate: toDateInputValue(end),
    endTime: toTimeInputValue(end),
  };
}

// "i want to add more day and time" — a new slot defaults to the day
// after the last one, same times, since that's the common case (a
// weekend tournament blocking the same hours Saturday and Sunday).
function makeNextSlot(previous: EventSlot): EventSlot {
  const nextStartDate = new Date(`${previous.startDate}T00:00:00`);
  nextStartDate.setDate(nextStartDate.getDate() + 1);
  const nextEndDate = new Date(`${previous.endDate}T00:00:00`);
  nextEndDate.setDate(nextEndDate.getDate() + 1);
  return {
    id: crypto.randomUUID(),
    startDate: toDateInputValue(nextStartDate),
    startTime: previous.startTime,
    endDate: toDateInputValue(nextEndDate),
    endTime: previous.endTime,
  };
}

export function SpecialEventForm({ courts }: SpecialEventFormProps) {
  const router = useRouter();
  // Defaults to OPEN_PLAY: the owner's reason for this page existing is
  // handing courts to open play for one night. Special events are the
  // rarer case now.
  const [kind, setKind] = useState<BlockKind>("OPEN_PLAY");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [courtIds, setCourtIds] = useState<string[]>([]);
  const [slots, setSlots] = useState<EventSlot[]>(() => [makeDefaultSlot()]);
  const [slotErrors, setSlotErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleCourt(courtId: string, checked: boolean) {
    setCourtIds((current) =>
      checked ? [...current, courtId] : current.filter((id) => id !== courtId),
    );
  }

  function updateSlot(id: string, patch: Partial<EventSlot>) {
    setSlots((current) => current.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)));
  }

  function addSlot() {
    setSlots((current) => [...current, makeNextSlot(current[current.length - 1])]);
  }

  function removeSlot(id: string) {
    setSlots((current) => (current.length > 1 ? current.filter((slot) => slot.id !== id) : current));
  }

  function resetForm() {
    setReason("");
    setNotes("");
    setCourtIds([]);
    setSlots([makeDefaultSlot()]);
    setSlotErrors({});
    setFormError(null);
  }

  // Owner report (2026-08-09): "it doesnt say anything after i click on
  // block courts for this event" — the previous react-hook-form +
  // zodResolver + setValue wiring for the split date/time fields could
  // silently leave the form in an unsubmittable state with no visible
  // error. Rewritten with plain state and an explicit validate-then-
  // submit path: every failure (missing field, bad date, server error)
  // always produces either a toast or an inline message — nothing fails
  // silently.
  function handleSubmit() {
    setFormError(null);
    setSlotErrors({});

    if (!reason.trim()) {
      setFormError("A name is required.");
      toast.error("A name is required.");
      return;
    }

    if (courtIds.length === 0) {
      setFormError("Select at least one court.");
      toast.error("Select at least one court.");
      return;
    }

    const parsedSlots: { slot: EventSlot; startAt: Date; endAt: Date }[] = [];
    const newSlotErrors: Record<string, string> = {};

    for (const slot of slots) {
      if (!slot.startDate || !slot.startTime || !slot.endDate || !slot.endTime) {
        newSlotErrors[slot.id] = "Pick a date and time for both Starts and Ends.";
        continue;
      }
      const parsed = specialEventSchema.safeParse({
        reason,
        notes: notes || undefined,
        courtIds,
        startAt: `${slot.startDate}T${slot.startTime}`,
        endAt: `${slot.endDate}T${slot.endTime}`,
      });
      if (!parsed.success) {
        newSlotErrors[slot.id] = parsed.error.issues[0]?.message ?? "Invalid date or time.";
        continue;
      }
      parsedSlots.push({ slot, startAt: parsed.data.startAt, endAt: parsed.data.endAt });
    }

    if (Object.keys(newSlotErrors).length > 0) {
      setSlotErrors(newSlotErrors);
      toast.error("Fix the highlighted date/time before blocking.");
      return;
    }

    startTransition(async () => {
      const results = await Promise.all(
        parsedSlots.map(({ slot, startAt, endAt }) =>
          scheduleSpecialEventAction({
            kind,
            reason,
            notes: notes || undefined,
            courtIds,
            startAt,
            endAt,
          }).then(
            (result) => ({ slot, result }),
          ),
        ),
      );

      const failed = results.filter(({ result }) => result.error);
      if (failed.length === 0) {
        toast.success(
          `Blocked ${courtIds.length} court${courtIds.length === 1 ? "" : "s"} across ${results.length} day${
            results.length === 1 ? "" : "s"
          }.`,
        );
        resetForm();
        router.refresh();
        return;
      }

      const nextSlotErrors: Record<string, string> = {};
      for (const { slot, result } of failed) {
        if (result.error) nextSlotErrors[slot.id] = result.error;
      }
      setSlotErrors(nextSlotErrors);
      const succeeded = results.length - failed.length;
      toast.error(
        succeeded > 0
          ? `Blocked ${succeeded} of ${results.length} day(s) — see the highlighted error below.`
          : (failed[0].result.error ?? "Failed to block the courts."),
      );
      // Owner report (2026-08-09): "everytime i click on block court it
      // doesnt appear" — the Cancel button already called router.refresh()
      // after its own action; this form never did, so newly created
      // blocks (partial or full success) never showed up in "Upcoming
      // and past events" until an unrelated navigation happened to
      // refetch the page. Refresh on the partial-success path too, since
      // some rows really were created.
      if (succeeded > 0) router.refresh();
    });
  }

  const isOpenPlay = kind === "OPEN_PLAY";

  return (
    <div className="flex flex-col gap-4">
      {/* Chosen FIRST, because it changes what the fields below mean —
          an open-play night has no "event name" in any useful sense. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="blockKind">Reason</Label>
        <Select value={kind} onValueChange={(value) => setKind((value ?? "OPEN_PLAY") as BlockKind)}>
          <SelectTrigger id="blockKind" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="OPEN_PLAY">Open play — shows as normal open-play hours</SelectItem>
            <SelectItem value="SPECIAL_EVENT">
              Special event — shows &quot;Booked for special events&quot;
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reason">{isOpenPlay ? "Label (internal)" : "Event name"}</Label>
        <Input
          id="reason"
          placeholder={isOpenPlay ? "e.g. Friday open play" : "e.g. Private tournament"}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {isOpenPlay ? (
          <p className="text-muted-foreground text-xs">
            Not shown to customers — the grid just says &quot;Open play&quot;, exactly like the
            regular open-play hours.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Courts</Label>
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          {courts.map((court) => (
            <div key={court.id} className="flex items-center justify-between gap-3">
              <Label htmlFor={`court-${court.id}`} className="font-normal">
                {court.name}
              </Label>
              <Switch
                id={`court-${court.id}`}
                checked={courtIds.includes(court.id)}
                onCheckedChange={(checked) => toggleCourt(court.id, checked)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {slots.map((slot, index) => (
          <div key={slot.id} className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Day {index + 1}</span>
              {slots.length > 1 ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => removeSlot(slot.id)}>
                  Remove
                </Button>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground text-xs font-normal">Starts</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  aria-label="Start date"
                  value={slot.startDate}
                  onChange={(event) => updateSlot(slot.id, { startDate: event.target.value })}
                />
                <Input
                  type="time"
                  aria-label="Start time"
                  value={slot.startTime}
                  onChange={(event) => updateSlot(slot.id, { startTime: event.target.value })}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground text-xs font-normal">Ends</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  aria-label="End date"
                  value={slot.endDate}
                  onChange={(event) => updateSlot(slot.id, { endDate: event.target.value })}
                />
                <Input
                  type="time"
                  aria-label="End time"
                  value={slot.endTime}
                  onChange={(event) => updateSlot(slot.id, { endTime: event.target.value })}
                />
              </div>
            </div>

            {slotErrors[slot.id] ? (
              <p className="text-destructive text-sm" role="alert">
                {slotErrors[slot.id]}
              </p>
            ) : null}
          </div>
        ))}

        <Button type="button" variant="outline" onClick={addSlot}>
          Add another day/time
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes (internal, not shown publicly)</Label>
        <Textarea id="notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>

      {formError ? (
        <p className="text-destructive text-sm" role="alert">
          {formError}
        </p>
      ) : null}

      <Button type="button" disabled={isPending} onClick={handleSubmit}>
        {isPending ? "Blocking…" : "Block courts for this event"}
      </Button>
    </div>
  );
}
