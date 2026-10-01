"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setOpenPlayScheduleAction } from "@/actions/cms.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Weekday key ("0"-"6", Date#getDay()) -> court name -> open-play hours.
type WeeklySchedule = Record<string, Record<string, number[]>>;

const WEEKDAYS = [
  { key: "1", label: "Mon" },
  { key: "2", label: "Tue" },
  { key: "3", label: "Wed" },
  { key: "4", label: "Thu" },
  { key: "5", label: "Fri" },
  { key: "6", label: "Sat" },
  { key: "0", label: "Sun" },
];

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

function sameHours(a: number[] = [], b: number[] = []): boolean {
  return [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join();
}

export function OpenPlaySchedulePanel({
  courtNames,
  hours,
  todayKey,
  initialSchedule,
  hasSavedSchedule,
  fridaySaturdayCloseTime,
}: {
  courtNames: string[];
  hours: number[];
  todayKey: string;
  initialSchedule: WeeklySchedule;
  // False until the first save: the grid then shows the current cutoffs,
  // and saving them unchanged is still a real change (they become the
  // schedule).
  hasSavedSchedule: boolean;
  fridaySaturdayCloseTime: string;
}) {
  const router = useRouter();
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [savedSchedule, setSavedSchedule] = useState(initialSchedule);
  const [schedule, setSchedule] = useState(initialSchedule);
  const [isSaved, setIsSaved] = useState(hasSavedSchedule);
  const [isPending, startTransition] = useTransition();

  const isDayDirty = (dayKey: string) =>
    courtNames.some((name) => !sameHours(schedule[dayKey]?.[name], savedSchedule[dayKey]?.[name]));
  const isDirty = WEEKDAYS.some((day) => isDayDirty(day.key));

  // From this hour on Fri/Sat every court is the Unliplay night, which the
  // schedule does not control — shown locked so the grid doesn't lie.
  const isFriSat = selectedDay === "5" || selectedDay === "6";
  const [cutoffHours, cutoffMinutes] = fridaySaturdayCloseTime.split(":").map(Number);
  const unliplayStartMinutes = cutoffHours === 0 && cutoffMinutes === 0 ? null : cutoffHours * 60 + cutoffMinutes;
  const isUnliplayHour = (hour: number) =>
    isFriSat && unliplayStartMinutes !== null && (hour + 1) * 60 > unliplayStartMinutes;

  function toggle(courtName: string, hour: number) {
    setSchedule((previous) => {
      const current = previous[selectedDay]?.[courtName] ?? [];
      const next = current.includes(hour) ? current.filter((h) => h !== hour) : [...current, hour];
      return { ...previous, [selectedDay]: { ...previous[selectedDay], [courtName]: next } };
    });
  }

  function copyToEveryDay() {
    setSchedule((previous) =>
      Object.fromEntries(WEEKDAYS.map((day) => [day.key, { ...previous[selectedDay] }])),
    );
    toast.info("Copied to every day. Save to apply.");
  }

  function handleSave() {
    startTransition(async () => {
      const result = await setOpenPlayScheduleAction(schedule);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setSavedSchedule(schedule);
      setIsSaved(true);
      toast.success("Open play schedule saved.");
      router.refresh();
    });
  }

  const selectedLabel = WEEKDAYS.find((day) => day.key === selectedDay)?.label;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Day of the week">
          {WEEKDAYS.map((day) => (
            <button
              key={day.key}
              type="button"
              role="tab"
              aria-selected={day.key === selectedDay}
              onClick={() => setSelectedDay(day.key)}
              className={cn(
                "relative flex flex-col items-center rounded-md border px-1 py-1.5 text-sm font-medium transition-colors",
                day.key === selectedDay
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {day.label}
              <span className="text-[10px] leading-none font-normal opacity-80">
                {day.key === todayKey ? "Today" : " "}
              </span>
              {isDayDirty(day.key) && (
                <span className="absolute top-1 right-1 size-1.5 rounded-full bg-amber-500" aria-label="Unsaved changes" />
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="bg-background size-3 rounded-sm border" /> Open for booking
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-emerald-500" /> Open play
          </span>
          {isFriSat && (
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded-sm bg-emerald-500/40" /> Unliplay night (all courts)
            </span>
          )}
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
                  if (isUnliplayHour(hour)) {
                    return (
                      <td key={name} className="p-0.5">
                        <div className="flex h-9 w-full items-center justify-center rounded-md bg-emerald-500/40 text-xs font-medium text-emerald-950 dark:text-emerald-50">
                          Unliplay
                        </div>
                      </td>
                    );
                  }
                  const isOpenPlay = schedule[selectedDay]?.[name]?.includes(hour) ?? false;
                  return (
                    <td key={name} className="p-0.5">
                      <button
                        type="button"
                        aria-pressed={isOpenPlay}
                        aria-label={`${name} ${selectedLabel} ${formatHour(hour)}: ${isOpenPlay ? "open play" : "open for booking"}`}
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
          <li>Each day repeats every week. For a one-off date, use Block Courts.</li>
          <li>Bookings already made keep their slot, even in an hour you switch to open play.</li>
          <li>
            On Fridays and Saturdays, every court goes to the Unliplay night at {formatTime(fridaySaturdayCloseTime)}.
            Change that time under Website → Court Hours.
          </li>
          <li>Staff can still book an open-play hour from the dashboard; it is flagged as after hours.</li>
        </ul>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={isPending || (isSaved && !isDirty)} onClick={handleSave}>
            {isPending ? "Saving…" : "Save schedule"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={copyToEveryDay}>
            Copy {selectedLabel} to every day
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending || !isDirty}
            onClick={() => setSchedule(savedSchedule)}
          >
            Undo changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
