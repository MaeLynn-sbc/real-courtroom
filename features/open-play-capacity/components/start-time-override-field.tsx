"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  overrideSessionStartTimeAction,
  resetSessionStartTimeAction,
} from "@/actions/open-play-capacity.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface StartTimeOverrideFieldProps {
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM", the session's current effective start
  overridden: boolean;
}

// Owner request (2026-08-08): "sometimes we want to have open play at
// earlier times." Real enforcement, not display-only — saving here moves
// the court-booking cutoff itself (lib/court-hours.ts's
// startTimeOverrideMinutes), so a court that was bookable a minute ago can
// become unavailable the moment this is saved, and the public grid/booking
// forms reflect it on next load. "Reset" clears back to the global
// fridaySaturdayCloseTime default rather than leaving a stale override in
// place after a one-off early night.
export function StartTimeOverrideField({ date, startTime, overridden }: StartTimeOverrideFieldProps) {
  const router = useRouter();
  const [value, setValue] = useState(startTime);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await overrideSessionStartTimeAction({ date, startTime: value });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Open Play start time updated for this night.");
      router.refresh();
    });
  }

  function handleReset() {
    startTransition(async () => {
      const result = await resetSessionStartTimeAction({ date });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Reset to the default start time.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="startTimeOverride" className="text-muted-foreground text-xs">
        Open Play start time for this night{overridden ? " (overridden)" : ""}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="startTimeOverride"
          type="time"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={isPending}
          className="max-w-[140px]"
        />
        <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleSave}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        {overridden ? (
          <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={handleReset}>
            Reset to default
          </Button>
        ) : null}
      </div>
      <span className="text-muted-foreground text-[11px]">
        Courts stop taking bookings at this time on {date} — it also blocks the public schedule.
      </span>
    </div>
  );
}
