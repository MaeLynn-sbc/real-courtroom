"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setRegularPlayHoursForDateAction } from "@/actions/open-play-capacity.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Court name -> open-play hours (0-23).
type CourtHours = Record<string, number[]>;

function formatHour(hour: number): string {
  const period = hour % 24 >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour} ${period}`;
}

function sameHours(a: number[] = [], b: number[] = []): boolean {
  return [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join();
}

// The Open Play Schedule grid for ONE regular-play date: tap an hour to
// switch a court between booking and open play for this date only.
// Starts from the weekly schedule until the first save.
export function RegularPlayHoursPanel({
  date,
  courtNames,
  hours,
  initialHours,
}: {
  date: string; // "YYYY-MM-DD"
  courtNames: string[];
  hours: number[];
  initialHours: CourtHours;
}) {
  const router = useRouter();
  const [savedHours, setSavedHours] = useState(initialHours);
  const [selectedHours, setSelectedHours] = useState(initialHours);
  const [isPending, startTransition] = useTransition();

  const isDirty = courtNames.some((name) => !sameHours(selectedHours[name], savedHours[name]));

  function toggle(courtName: string, hour: number) {
    setSelectedHours((previous) => {
      const current = previous[courtName] ?? [];
      const next = current.includes(hour) ? current.filter((h) => h !== hour) : [...current, hour];
      return { ...previous, [courtName]: next };
    });
  }

  function handleSave() {
    startTransition(async () => {
      const result = await setRegularPlayHoursForDateAction({ date, hours: selectedHours });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setSavedHours(selectedHours);
      toast.success("Court hours saved for this date.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Courts for this date</CardTitle>
        <p className="text-muted-foreground text-sm">
          Tap an hour to switch it between booking and open play. Applies to this date only.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="bg-background size-3 rounded-sm border" /> Open for booking
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-emerald-500" /> Open play (₱35 per game)
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
                  const isOpenPlay = selectedHours[name]?.includes(hour) ?? false;
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

        <p className="text-muted-foreground text-xs">
          Bookings already made keep their slot, even in an hour you switch to open play.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={isPending || !isDirty} onClick={handleSave}>
            {isPending ? "Saving…" : "Save court hours"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending || !isDirty}
            onClick={() => setSelectedHours(savedHours)}
          >
            Undo changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
