"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setOpenPlayScheduleAction } from "@/actions/cms.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function formatHour(hour: number): string {
  const period = hour % 24 >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour} ${period}`;
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const label = formatHour(hours);
  return minutes === 0 ? label : label.replace(" ", `:${String(minutes).padStart(2, "0")} `);
}

export function OpenPlaySchedulePanel({
  courtNames,
  hours,
  initialOpenPlayHours,
  hasSavedSchedule,
  fridaySaturdayCloseTime,
}: {
  courtNames: string[];
  hours: number[];
  initialOpenPlayHours: Record<string, number[]>;
  // False until the first save: the grid then shows today's cutoffs, and
  // saving them unchanged is still a real change (it becomes the schedule).
  hasSavedSchedule: boolean;
  fridaySaturdayCloseTime: string;
}) {
  const router = useRouter();
  const [savedOpenPlayHours, setSavedOpenPlayHours] = useState(initialOpenPlayHours);
  const [openPlayHours, setOpenPlayHours] = useState(initialOpenPlayHours);
  const [isSaved, setIsSaved] = useState(hasSavedSchedule);
  const [isPending, startTransition] = useTransition();

  const isDirty = courtNames.some(
    (name) => [...(openPlayHours[name] ?? [])].sort().join() !== [...(savedOpenPlayHours[name] ?? [])].sort().join(),
  );

  function toggle(courtName: string, hour: number) {
    setOpenPlayHours((previous) => {
      const current = previous[courtName] ?? [];
      const next = current.includes(hour) ? current.filter((h) => h !== hour) : [...current, hour];
      return { ...previous, [courtName]: next };
    });
  }

  function handleSave() {
    startTransition(async () => {
      const result = await setOpenPlayScheduleAction(openPlayHours);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setSavedOpenPlayHours(openPlayHours);
      setIsSaved(true);
      toast.success("Open play schedule saved.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="bg-background size-3 rounded-sm border" /> Open for booking
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-emerald-500" /> Open play
          </span>
        </div>

        <table className="w-full table-fixed text-sm">
          <thead>
            <tr>
              <th className="w-20" />
              {courtNames.map((name) => (
                <th key={name} className="pb-2 text-center font-medium">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((hour) => (
              <tr key={hour}>
                <td className="text-muted-foreground pr-2 text-xs whitespace-nowrap">{formatHour(hour)}</td>
                {courtNames.map((name) => {
                  const isOpenPlay = openPlayHours[name]?.includes(hour) ?? false;
                  return (
                    <td key={name} className="p-0.5">
                      <button
                        type="button"
                        aria-pressed={isOpenPlay}
                        aria-label={`${name} ${formatHour(hour)}: ${isOpenPlay ? "open play" : "open for booking"}`}
                        onClick={() => toggle(name, hour)}
                        className={cn(
                          "h-9 w-full rounded-md border text-xs font-medium transition-colors",
                          isOpenPlay
                            ? "border-emerald-600 bg-emerald-500 text-white hover:bg-emerald-600"
                            : "bg-background text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {isOpenPlay ? "Open play" : "Booking"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
          <li>Bookings already made keep their slot, even in an hour you switch to open play.</li>
          <li>
            On Fridays and Saturdays, every court goes to the Unliplay night at {formatTime(fridaySaturdayCloseTime)}{" "}
            no matter what this schedule says. Change that time under Website → Court Hours.
          </li>
          <li>Staff can still book an open-play hour from the dashboard; it is flagged as after hours.</li>
        </ul>

        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={isPending || (isSaved && !isDirty)} onClick={handleSave}>
            {isPending ? "Saving…" : "Save daily schedule"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending || !isDirty}
            onClick={() => setOpenPlayHours(savedOpenPlayHours)}
          >
            Undo changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
