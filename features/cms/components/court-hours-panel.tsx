"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setCourtHoursAction } from "@/actions/cms.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeSelect } from "@/components/shared/time-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CourtHoursSettings } from "@/features/cms/schemas/cms.schema";

interface CourtHoursCourt {
  id: string;
  name: string;
}

const WEEKDAYS: { key: keyof CourtHoursSettings["facilityCloseTimes"]; label: string }[] = [
  { key: "0", label: "Sun" },
  { key: "1", label: "Mon" },
  { key: "2", label: "Tue" },
  { key: "3", label: "Wed" },
  { key: "4", label: "Thu" },
  { key: "5", label: "Fri" },
  { key: "6", label: "Sat" },
];

// Fri/Sat are left out: those nights run the Unliplay handover off their
// own settings above, and getCourtBookingWindow ignores this map for them.
const SUN_TO_THU = WEEKDAYS.filter((day) => day.key !== "5" && day.key !== "6");

// A cleared time input gives "", which the schema rejects. Blank means "no
// exception", so drop it — and any weekday left with no courts — keeping
// the stored map sparse.
function pruneWeekdayOverrides(
  overrides: NonNullable<CourtHoursSettings["courtCloseTimesByWeekday"]>,
): NonNullable<CourtHoursSettings["courtCloseTimesByWeekday"]> {
  const pruned: NonNullable<CourtHoursSettings["courtCloseTimesByWeekday"]> = {};
  for (const [dayKey, byCourt] of Object.entries(overrides)) {
    const kept = Object.fromEntries(Object.entries(byCourt).filter(([, time]) => time));
    if (Object.keys(kept).length > 0) {
      pruned[dayKey] = kept;
    }
  }
  return pruned;
}

export function CourtHoursPanel({
  courtHours,
  courts,
}: {
  courtHours: CourtHoursSettings;
  courts: CourtHoursCourt[];
}) {
  const router = useRouter();
  const [facilityOpenTime, setFacilityOpenTime] = useState(courtHours.facilityOpenTime);
  const [facilityCloseTimes, setFacilityCloseTimes] = useState(courtHours.facilityCloseTimes);
  const [fridaySaturdayCloseTime, setFridaySaturdayCloseTime] = useState(
    courtHours.fridaySaturdayCloseTime,
  );
  const [courtCloseTimes, setCourtCloseTimes] = useState(courtHours.courtCloseTimes);
  const [fridaySaturdayCourtCloseTimes, setFridaySaturdayCourtCloseTimes] = useState(
    courtHours.fridaySaturdayCourtCloseTimes ?? {},
  );
  const [courtCloseTimesByWeekday, setCourtCloseTimesByWeekday] = useState(
    courtHours.courtCloseTimesByWeekday ?? {},
  );
  const [businessDateRolloverHour, setBusinessDateRolloverHour] = useState(
    courtHours.businessDateRolloverHour,
  );
  const [isPending, startTransition] = useTransition();

  function save(next: CourtHoursSettings) {
    startTransition(async () => {
      const result = await setCourtHoursAction(next);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setFacilityOpenTime(next.facilityOpenTime);
      setFacilityCloseTimes(next.facilityCloseTimes);
      setFridaySaturdayCloseTime(next.fridaySaturdayCloseTime);
      setCourtCloseTimes(next.courtCloseTimes);
      setFridaySaturdayCourtCloseTimes(next.fridaySaturdayCourtCloseTimes ?? {});
      setCourtCloseTimesByWeekday(next.courtCloseTimesByWeekday ?? {});
      setBusinessDateRolloverHour(next.businessDateRolloverHour);
      toast.success("Court hours saved.");
      router.refresh();
    });
  }

  function handleSave() {
    save({
      facilityOpenTime,
      facilityCloseTimes,
      fridaySaturdayCloseTime,
      fridaySaturdayCourtCloseTimes,
      courtCloseTimes,
      courtCloseTimesByWeekday: pruneWeekdayOverrides(courtCloseTimesByWeekday),
      // Edited on its own page (Open Play Schedule); carried through so
      // saving this panel never wipes it.
      openPlayHoursByWeekday: courtHours.openPlayHoursByWeekday,
      businessDateRolloverHour,
    });
  }

  function setWeekdayOverride(dayKey: string, courtName: string, time: string) {
    setCourtCloseTimesByWeekday((previous) => ({
      ...previous,
      [dayKey]: { ...previous[dayKey], [courtName]: time },
    }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Court Hours</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {courtHours.openPlayHoursByWeekday &&
          Object.keys(courtHours.openPlayHoursByWeekday).length > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              Courts with a saved{" "}
              <Link href="/dashboard/admin/open-play-schedule" className="font-medium underline">
                Open Play Schedule
              </Link>{" "}
              follow it instead of the per-court cutoffs below. The Fri/Sat all-courts cutoff still
              starts the Unliplay night.
            </p>
          )}
        <p className="text-muted-foreground text-sm">
          Controls the public availability grid and blocks online bookings outside these windows.
          Staff can still book any court/time from the dashboard — it&apos;s just flagged
          &quot;after hours&quot; for reporting instead of blocked.
        </p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="facilityOpenTime">Opens (every day)</Label>
          <TimeSelect
            firstHour={0}
            id="facilityOpenTime"
            className="w-32"
            value={facilityOpenTime}
            onChange={(time) => setFacilityOpenTime(time)}
          />
        </div>

        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Facility close (per weekday)
          </p>
          <p className="text-muted-foreground text-xs">
            The building&apos;s own closing time — a hard cap no court cutoff below can exceed.
          </p>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {WEEKDAYS.map((day) => (
              <div key={day.key} className="flex flex-col gap-1">
                <Label htmlFor={`facilityClose-${day.key}`} className="text-xs">
                  {day.label}
                </Label>
                <TimeSelect
                  firstHour={0}
                  id={`facilityClose-${day.key}`}
                  value={facilityCloseTimes[day.key] ?? "23:00"}
                  onChange={(time) =>
                    setFacilityCloseTimes((previous) => ({ ...previous, [day.key]: time }))
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t pt-4">
          <Label htmlFor="fridaySaturdayCloseTime">Fri/Sat cutoff (all courts)</Label>
          <TimeSelect
            firstHour={0}
            id="fridaySaturdayCloseTime"
            className="w-32"
            value={fridaySaturdayCloseTime}
            onChange={(time) => setFridaySaturdayCloseTime(time)}
          />
          <p className="text-muted-foreground text-xs">
            When the Fri/Sat open-play night starts. A court below can hand over earlier than this,
            never later.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {courts.map((court) => (
              <div key={court.id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                <Label htmlFor={`friSatCourtClose-${court.id}`}>{court.name} (Fri/Sat)</Label>
                <TimeSelect
                  firstHour={0}
                  id={`friSatCourtClose-${court.id}`}
                  className="w-32"
                  value={fridaySaturdayCourtCloseTimes[court.name] ?? "00:00"}
                  onChange={(time) =>
                    setFridaySaturdayCourtCloseTimes((previous) => ({
                      ...previous,
                      [court.name]: time,
                    }))
                  }
                />
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            12 AM means the court simply uses the all-courts Fri/Sat cutoff above.
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Per-court cutoff (Sunday–Thursday)
          </p>
          <div className="flex flex-col gap-2">
            {courts.map((court) => (
              <div key={court.id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                <Label htmlFor={`courtClose-${court.id}`}>{court.name}</Label>
                <TimeSelect
                  firstHour={0}
                  id={`courtClose-${court.id}`}
                  className="w-32"
                  value={courtCloseTimes[court.name] ?? "00:00"}
                  onChange={(time) =>
                    setCourtCloseTimes((previous) => ({ ...previous, [court.name]: time }))
                  }
                />
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            12 AM means no cutoff of its own — the court runs until facility close instead.
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Weekday exceptions (Sunday–Thursday)
          </p>
          <p className="text-muted-foreground text-xs">
            A different cutoff for one court on one weekday, every week — e.g. Court 2 handing over
            to open play at 6 PM on Wednesdays and Thursdays. Leave blank to use the per-court
            cutoff above.
          </p>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th />
                  {SUN_TO_THU.map((day) => (
                    <th
                      key={day.key}
                      className="text-muted-foreground px-1 pb-1 text-left text-xs font-medium"
                    >
                      {day.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {courts.map((court) => (
                  <tr key={court.id}>
                    <td className="pr-2 whitespace-nowrap">{court.name}</td>
                    {SUN_TO_THU.map((day) => (
                      <td key={day.key} className="p-1">
                        <TimeSelect
                          firstHour={0}
                          emptyLabel="—"
                          aria-label={`${court.name} cutoff on ${day.label}`}
                          className="w-28"
                          value={courtCloseTimesByWeekday[day.key]?.[court.name] ?? ""}
                          onChange={(time) => setWeekdayOverride(day.key, court.name, time)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t pt-4">
          <Label htmlFor="businessDateRolloverHour">Business day rolls over at</Label>
          <div className="flex items-center gap-2">
            <Input
              id="businessDateRolloverHour"
              type="number"
              min={0}
              max={23}
              className="w-20"
              value={businessDateRolloverHour}
              onChange={(event) => setBusinessDateRolloverHour(Number(event.target.value))}
            />
            <span className="text-muted-foreground text-sm">
              :00 — a booking before this hour still counts toward the previous night
            </span>
          </div>
        </div>

        <Button
          type="button"
          size="sm"
          disabled={isPending}
          onClick={handleSave}
          className="self-start"
        >
          {isPending ? "Saving…" : "Save court hours"}
        </Button>
      </CardContent>
    </Card>
  );
}
