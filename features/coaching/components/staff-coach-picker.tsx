"use client";

import { useEffect, useState } from "react";

import { listAvailableCoachesForSlotAction, type StaffCoachOption } from "@/actions/coaching.actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { coachingFeeCents } from "@/lib/booking-payment-total";
import { coachSessionWindow, describeTimeWindow } from "@/lib/coach-session-window";
import { formatCurrency } from "@/lib/utils";

import { CoachWindowPicker } from "./coach-window-picker";

export interface StaffCoachSelection {
  coachId: string;
  coachName: string;
  groupSize: number;
  /** The HOURLY rate; feeCents is what the booking is charged. */
  priceCents: number;
  hours: number;
  startOffsetHours: number;
  feeCents: number;
}

export interface StaffCoachPickerState {
  selection: StaffCoachSelection | null;
  // Non-null only when a coach + group size are both picked but that
  // group size has no rate row — the exact case that must block
  // submitting the booking, not just fail silently after the fact.
  blockingError: string | null;
}

// Mirrors describeConflict("NO_RATE_SET") in coach-session.service.ts —
// the server enforces the real rejection with this same text if this
// client-side check is ever wrong or bypassed; kept as a literal, not
// imported, since that constant lives behind server-only code.
const NO_RATE_SET_MESSAGE = "No rate is set for this coach at this group size.";

interface StaffCoachPickerProps {
  slotStartAt: Date | null;
  slotEndAt: Date | null;
  onStateChange: (state: StaffCoachPickerState) => void;
}

// Staff-desk companion to PublicCoachAddOn — same live-availability
// source, but shown BEFORE the booking exists (re-fetched as the staff
// member edits court/date/time/duration) rather than as a post-creation
// add-on, and with no rates.length filter: staff can select any coach
// free for the slot, with an unpriced group size caught here instead of
// hidden from the list (see StaffCoachOption's own comment).
export function StaffCoachPicker({ slotStartAt, slotEndAt, onStateChange }: StaffCoachPickerProps) {
  const [coaches, setCoaches] = useState<StaffCoachOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [coachId, setCoachId] = useState("");
  const [groupSize, setGroupSize] = useState("");
  const [window, setWindow] = useState({ hours: 1, startOffsetHours: 0 });

  const slotKey = slotStartAt && slotEndAt ? `${slotStartAt.getTime()}-${slotEndAt.getTime()}` : null;

  useEffect(() => {
    if (!slotStartAt || !slotEndAt) {
      setCoaches([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    listAvailableCoachesForSlotAction(slotStartAt, slotEndAt).then((result) => {
      if (cancelled) {
        return;
      }
      setIsLoading(false);
      setCoaches(result.coaches);
    });
    return () => {
      cancelled = true;
    };
    // slotKey, not the Date objects themselves, is the real dependency —
    // slotStartAt/slotEndAt are new object identities on every parent
    // render even when the wall-clock instant hasn't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey]);

  const selectedCoach = coaches.find((coach) => coach.id === coachId);

  // The slot changed underneath an existing pick and the coach dropped
  // out of the freshly-fetched available list — clear rather than keep a
  // selection the server would reject anyway.
  useEffect(() => {
    if (coachId && !isLoading && !coaches.some((coach) => coach.id === coachId)) {
      setCoachId("");
      setGroupSize("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coaches, isLoading]);

  useEffect(() => {
    const size = Number(groupSize);
    if (!selectedCoach || !groupSize || !Number.isInteger(size) || size < 1) {
      onStateChange({ selection: null, blockingError: null });
      return;
    }
    const rate = selectedCoach.rates.find((r) => r.groupSize === size);
    if (!rate) {
      onStateChange({ selection: null, blockingError: NO_RATE_SET_MESSAGE });
      return;
    }
    onStateChange({
      selection: {
        coachId: selectedCoach.id,
        coachName: selectedCoach.name,
        groupSize: size,
        priceCents: rate.priceCents,
        hours: window.hours,
        startOffsetHours: window.startOffsetHours,
        feeCents: coachingFeeCents({ rateCents: rate.priceCents, hours: window.hours }),
      },
      blockingError: null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCoach, groupSize, window.hours, window.startOffsetHours]);

  if (!slotStartAt || !slotEndAt) {
    return null;
  }

  const size = Number(groupSize);
  const selectedRate = selectedCoach && Number.isInteger(size) && size >= 1
    ? selectedCoach.rates.find((r) => r.groupSize === size)
    : undefined;
  const noRateForGroupSize = Boolean(selectedCoach && groupSize && Number.isInteger(size) && size >= 1 && !selectedRate);

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border p-4">
      <Label htmlFor="staffCoachId">Coach (optional)</Label>
      {isLoading ? (
        <p className="text-muted-foreground text-sm">Checking availability…</p>
      ) : coaches.length === 0 ? (
        <p className="text-muted-foreground text-sm">No coach available for this time.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Select
            value={coachId}
            onValueChange={(value) => {
              setCoachId(value ?? "");
              setGroupSize("");
            }}
          >
            <SelectTrigger id="staffCoachId" className="w-full">
              <SelectValue placeholder="No coach">
                {(value: string) => coaches.find((coach) => coach.id === value)?.name ?? "No coach"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {coaches.map((coach) => (
                <SelectItem key={coach.id} value={coach.id}>
                  {coach.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {coachId ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="staffCoachGroupSize">Group size</Label>
              <Input
                id="staffCoachGroupSize"
                type="number"
                min={1}
                value={groupSize}
                onChange={(event) => setGroupSize(event.target.value)}
              />
              {selectedRate ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">Rate: </span>
                  <span className="font-medium">{formatCurrency(selectedRate.priceCents)}/hour</span>
                </p>
              ) : null}
              {selectedCoach ? (
                <CoachWindowPicker
                  idPrefix="staffCoach"
                  bookingStartAt={slotStartAt}
                  bookingEndAt={slotEndAt}
                  freeWindows={selectedCoach.freeWindows.map((w) => ({ startAt: new Date(w.startAt), endAt: new Date(w.endAt) }))}
                  value={window}
                  onChange={setWindow}
                />
              ) : null}
              {selectedRate ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">Coaching: </span>
                  <span className="font-medium">
                    {describeTimeWindow(coachSessionWindow(slotStartAt, window))} ·{" "}
                    {formatCurrency(coachingFeeCents({ rateCents: selectedRate.priceCents, hours: window.hours }))}
                  </span>
                </p>
              ) : null}
              {noRateForGroupSize ? (
                <p className="text-destructive text-xs" role="alert">
                  {NO_RATE_SET_MESSAGE}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
