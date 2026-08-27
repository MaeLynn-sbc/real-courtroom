"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { correctAttendanceEntryAction } from "@/actions/attendance-record.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LONG_SHIFT_WARNING_HOURS } from "@/lib/payroll/compute-day";

interface CorrectDayEntryFormProps {
  recordId: string;
  workDate: Date;
  clockIn: Date | null;
  clockOut: Date | null;
}

// Owner request (2026-08-27): "I want the admin or the owner can see a
// correct button after each date... to edit the forgotten log outs and
// all." The payroll preview is where a wrong clock-out is actually
// noticed — a 14-hour day standing out against a row of 7-hour ones — so
// it should be fixable there rather than making someone go and find the
// same date again in the attendance workspace.
//
// Same guarded path as that workspace's own correction: a required
// reason, and correctEntry never touches rawClockIn/rawClockOut, so the
// originally-recorded times survive every correction.
function toTimeValue(date: Date | null): string {
  if (!date) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function combine(workDate: Date, time: string): Date | null {
  if (!time) return null;
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(workDate.getFullYear(), workDate.getMonth(), workDate.getDate(), hours, minutes);
}

export function CorrectDayEntryForm({
  recordId,
  workDate,
  clockIn,
  clockOut,
}: CorrectDayEntryFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [inTime, setInTime] = useState(toTimeValue(clockIn));
  const [outTime, setOutTime] = useState(toTimeValue(clockOut));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Correct
      </Button>
    );
  }

  // Same auto-roll the attendance workspace uses: a clock-out at or
  // before the clock-in is an overnight shift, not an error.
  const start = combine(workDate, inTime);
  let end = combine(workDate, outTime);
  const rolled = Boolean(start && end && end.getTime() <= start.getTime());
  if (rolled && end) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  const spanHours = start && end ? (end.getTime() - start.getTime()) / 3_600_000 : null;
  const isLong = spanHours !== null && spanHours > LONG_SHIFT_WARNING_HOURS;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!start) {
      setError("Enter a clock-in time.");
      return;
    }
    if (!reason.trim()) {
      setError("Enter a reason for this correction.");
      return;
    }

    startTransition(async () => {
      const result = await correctAttendanceEntryAction({
        recordId,
        clockIn: start,
        clockOut: end ?? undefined,
        reason: reason.trim(),
      });
      if (result.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Attendance corrected — the day's pay has been recalculated.");
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-w-[15rem] flex-col gap-2 rounded-lg border border-dashed p-2 text-left"
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`in-${recordId}`} className="text-xs">
            Clock in
          </Label>
          <Input
            id={`in-${recordId}`}
            type="time"
            value={inTime}
            onChange={(event) => setInTime(event.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`out-${recordId}`} className="text-xs">
            Clock out
          </Label>
          <Input
            id={`out-${recordId}`}
            type="time"
            value={outTime}
            onChange={(event) => setOutTime(event.target.value)}
            disabled={isPending}
          />
        </div>
      </div>

      {rolled && end ? (
        <p className="text-muted-foreground text-xs">Ends {toTimeValue(end)} the next day.</p>
      ) : null}
      {isLong ? (
        <p className="text-xs text-amber-600 dark:text-amber-500" role="status">
          That is a {spanHours!.toFixed(1)}-hour shift — check the times.
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <Label htmlFor={`reason-${recordId}`} className="text-xs">
          Reason
        </Label>
        <Input
          id={`reason-${recordId}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. forgot to clock out"
          disabled={isPending}
        />
      </div>

      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
