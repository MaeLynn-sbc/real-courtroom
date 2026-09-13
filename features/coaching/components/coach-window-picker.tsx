"use client";

import { useEffect, useMemo } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  bookingWholeHours,
  coachSessionWindow,
  coachStartOffsets,
  describeTimeWindow,
  maxCoachHours,
  type TimeWindow,
} from "@/lib/coach-session-window";

export interface CoachWindowChoice {
  hours: number;
  startOffsetHours: number;
}

interface CoachWindowPickerProps {
  idPrefix: string;
  bookingStartAt: Date;
  bookingEndAt: Date;
  // The coach's free segments inside the booking. null = "any whole
  // hour of the booking" (the staff override, where availability is
  // deliberately bypassed); [] = nothing free.
  freeWindows: TimeWindow[] | null;
  value: CoachWindowChoice;
  onChange: (next: CoachWindowChoice) => void;
  disabled?: boolean;
}

// The two choices that define a coach's window — how many hours, and
// which hour of the court time it starts on — shared by every surface
// that attaches a coach (public form, public add-on, staff booking form,
// staff booking panel), so they all offer exactly the windows the
// service accepts and nothing else.
//
// Hours DEFAULT TO 1, never to the court length (owner, 2026-08-29:
// "that's gonna be too expensive"). The start defaults to the first hour
// the coach can take. The start picker only appears when there is a
// real choice, so a 1-hour booking looks exactly as it did before.
export function CoachWindowPicker({
  idPrefix,
  bookingStartAt,
  bookingEndAt,
  freeWindows,
  value,
  onChange,
  disabled,
}: CoachWindowPickerProps) {
  const anyWindow = useMemo<TimeWindow[]>(
    () => [{ startAt: bookingStartAt, endAt: bookingEndAt }],
    [bookingStartAt, bookingEndAt],
  );
  const windows = freeWindows ?? anyWindow;
  const maxHours = maxCoachHours(bookingStartAt, bookingEndAt, windows);
  const hourOptions = Array.from({ length: maxHours }, (_, index) => index + 1);
  const startOptions = coachStartOffsets(bookingStartAt, bookingEndAt, value.hours, windows);
  const totalHours = bookingWholeHours(bookingStartAt, bookingEndAt);

  // Keep the choice inside what is actually offered: if the coach or
  // the slot changed underneath it, snap to a legal window rather than
  // submit one the server would reject.
  useEffect(() => {
    if (maxHours === 0) return;
    const hours = Math.min(Math.max(1, value.hours), maxHours);
    const offsets = coachStartOffsets(bookingStartAt, bookingEndAt, hours, windows);
    const startOffsetHours = offsets.includes(value.startOffsetHours) ? value.startOffsetHours : (offsets[0] ?? 0);
    if (hours !== value.hours || startOffsetHours !== value.startOffsetHours) {
      onChange({ hours, startOffsetHours });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxHours, value.hours, value.startOffsetHours, bookingStartAt.getTime(), bookingEndAt.getTime(), windows]);

  if (maxHours === 0) {
    return null;
  }

  const chosen = coachSessionWindow(bookingStartAt, value);

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-hours`}>Coaching hours</Label>
        <Select
          value={String(value.hours)}
          onValueChange={(next) => onChange({ ...value, hours: Number(next ?? 1) })}
          disabled={disabled}
        >
          <SelectTrigger id={`${idPrefix}-hours`} className="w-full">
            <SelectValue>{(v: string) => `${v} ${Number(v) === 1 ? "hour" : "hours"}`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {hourOptions.map((hours) => (
              <SelectItem key={hours} value={String(hours)}>
                {hours} {hours === 1 ? "hour" : "hours"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {totalHours > value.hours ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-start`}>Coaching starts</Label>
          {startOptions.length > 1 ? (
            <Select
              value={String(value.startOffsetHours)}
              onValueChange={(next) => onChange({ ...value, startOffsetHours: Number(next ?? 0) })}
              disabled={disabled}
            >
              <SelectTrigger id={`${idPrefix}-start`} className="w-full">
                <SelectValue>
                  {(v: string) =>
                    describeTimeWindow(coachSessionWindow(bookingStartAt, { hours: value.hours, startOffsetHours: Number(v) }))
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {startOptions.map((offset) => (
                  <SelectItem key={offset} value={String(offset)}>
                    {describeTimeWindow(coachSessionWindow(bookingStartAt, { hours: value.hours, startOffsetHours: offset }))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            // Only one place the coach can take these hours: say which,
            // rather than hiding it — the customer and the coach both
            // need to know it is NOT the whole court time.
            <p id={`${idPrefix}-start`} className="text-sm">
              {describeTimeWindow(chosen)}
              <span className="text-muted-foreground"> (the only time this coach is free)</span>
            </p>
          )}
        </div>
      ) : null}
    </>
  );
}
