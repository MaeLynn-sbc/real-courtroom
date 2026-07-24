"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setCourtHoursAction } from "@/actions/cms.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const [fridaySaturdayCloseTime, setFridaySaturdayCloseTime] = useState(courtHours.fridaySaturdayCloseTime);
  const [courtCloseTimes, setCourtCloseTimes] = useState(courtHours.courtCloseTimes);
  const [businessDateRolloverHour, setBusinessDateRolloverHour] = useState(courtHours.businessDateRolloverHour);
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
      courtCloseTimes,
      businessDateRolloverHour,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Court Hours</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <p className="text-muted-foreground text-sm">
          Controls the public availability grid and blocks online bookings outside these windows. Staff
          can still book any court/time from the dashboard — it&apos;s just flagged &quot;after hours&quot; for
          reporting instead of blocked.
        </p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="facilityOpenTime">Opens (every day)</Label>
          <Input
            id="facilityOpenTime"
            type="time"
            className="w-32"
            value={facilityOpenTime}
            onChange={(event) => setFacilityOpenTime(event.target.value)}
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
                <Input
                  id={`facilityClose-${day.key}`}
                  type="time"
                  value={facilityCloseTimes[day.key] ?? "23:00"}
                  onChange={(event) =>
                    setFacilityCloseTimes((previous) => ({ ...previous, [day.key]: event.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t pt-4">
          <Label htmlFor="fridaySaturdayCloseTime">Fri/Sat cutoff (all courts)</Label>
          <Input
            id="fridaySaturdayCloseTime"
            type="time"
            className="w-32"
            value={fridaySaturdayCloseTime}
            onChange={(event) => setFridaySaturdayCloseTime(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Per-court cutoff (Sunday–Thursday)
          </p>
          <div className="flex flex-col gap-2">
            {courts.map((court) => (
              <div key={court.id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                <Label htmlFor={`courtClose-${court.id}`}>{court.name}</Label>
                <Input
                  id={`courtClose-${court.id}`}
                  type="time"
                  className="w-32"
                  value={courtCloseTimes[court.name] ?? "00:00"}
                  onChange={(event) =>
                    setCourtCloseTimes((previous) => ({ ...previous, [court.name]: event.target.value }))
                  }
                />
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            00:00 means no cutoff of its own — the court runs until facility close instead.
          </p>
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
            <span className="text-muted-foreground text-sm">:00 — a booking before this hour still counts toward the previous night</span>
          </div>
        </div>

        <Button type="button" size="sm" disabled={isPending} onClick={handleSave} className="self-start">
          {isPending ? "Saving…" : "Save court hours"}
        </Button>
      </CardContent>
    </Card>
  );
}
