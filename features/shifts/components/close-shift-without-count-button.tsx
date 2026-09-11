"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { closeShiftWithoutCountAction } from "@/actions/shift.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Management closing a shift an attendant forgot (owner request,
// 2026-09-11: "sometimes the staff forgets to do it", "close it as is").
//
// Deliberately NOT a one-tap button. Closing without a cash count skips
// the discipline every ordinary close goes through, so it asks for two
// things first:
//
//   END TIME   defaults to now, but is editable, because a shift
//              forgotten at 6pm and closed at 11pm would otherwise seed
//              an attendance record five hours too long — and attendance
//              feeds payroll.
//   REASON     required, and stored on the shift's closing notes, so the
//              record says why no count exists rather than leaving a
//              blank for someone to puzzle over later.
//
// The variance is left UNKNOWN, not zero — see
// shiftService.closeShiftWithoutCount.
export function CloseShiftWithoutCountButton({
  shiftId,
  employeeName,
}: {
  shiftId: string;
  employeeName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [endedAt, setEndedAt] = useState(() => toLocalDateTimeValue(new Date()));
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!isOpen) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setIsOpen(true)}>
        Close
      </Button>
    );
  }

  const submit = () => {
    if (!reason.trim()) {
      toast.error("Enter a reason.");
      return;
    }
    startTransition(async () => {
      const result = await closeShiftWithoutCountAction(shiftId, {
        endedAt: new Date(endedAt).toISOString(),
        reason,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${employeeName}'s shift closed without a cash count.`);
      setIsOpen(false);
      setReason("");
    });
  };

  return (
    <div className="border-warning/40 bg-warning/10 flex w-full flex-col gap-2 rounded-md border p-3">
      <p className="text-xs font-medium">
        Close {employeeName}&apos;s shift without counting the drawer
      </p>
      <p className="text-muted-foreground text-xs">
        No cash count is recorded, so this shift&apos;s variance stays unknown rather than being
        reported as zero.
      </p>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`endedAt-${shiftId}`} className="text-xs">
          Shift actually ended
        </Label>
        <Input
          id={`endedAt-${shiftId}`}
          type="datetime-local"
          value={endedAt}
          onChange={(event) => setEndedAt(event.target.value)}
          className="h-8"
        />
        <p className="text-muted-foreground text-[11px]">
          Used for payroll — set when they really finished, not now.
        </p>
      </div>

      <Input
        placeholder="Reason (e.g. staff went home without closing)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="h-8"
      />

      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={submit} disabled={isPending}>
          {isPending ? "Closing…" : "Close shift"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setIsOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function toLocalDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
