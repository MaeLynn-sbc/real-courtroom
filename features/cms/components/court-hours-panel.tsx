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

// "24:00" (midnight) can't round-trip through <input type="time">, which
// only accepts 00:00-23:59 — shown/edited as "00:00" with a "(midnight)"
// hint instead, and converted back to "24:00" on save.
function toTimeInputValue(time: string): string {
  return time === "24:00" ? "00:00" : time;
}

function fromTimeInputValue(value: string): string {
  return value === "00:00" ? "24:00" : value;
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
  const [fridaySaturdayCloseTime, setFridaySaturdayCloseTime] = useState(courtHours.fridaySaturdayCloseTime);
  const [courtCloseTimes, setCourtCloseTimes] = useState(courtHours.courtCloseTimes);
  const [isPending, startTransition] = useTransition();

  function save(next: CourtHoursSettings) {
    startTransition(async () => {
      const result = await setCourtHoursAction(next);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setFacilityOpenTime(next.facilityOpenTime);
      setFridaySaturdayCloseTime(next.fridaySaturdayCloseTime);
      setCourtCloseTimes(next.courtCloseTimes);
      toast.success("Court hours saved.");
      router.refresh();
    });
  }

  function handleSave() {
    save({ facilityOpenTime, fridaySaturdayCloseTime, courtCloseTimes });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Court Hours</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <p className="text-muted-foreground text-sm">
          Controls the public availability grid and blocks online bookings outside these windows —
          staff can still book any court/time from the dashboard.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="facilityOpenTime">Opens (every day)</Label>
            <Input
              id="facilityOpenTime"
              type="time"
              value={facilityOpenTime}
              onChange={(event) => setFacilityOpenTime(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fridaySaturdayCloseTime">Fri/Sat cutoff (all courts)</Label>
            <Input
              id="fridaySaturdayCloseTime"
              type="time"
              value={fridaySaturdayCloseTime}
              onChange={(event) => setFridaySaturdayCloseTime(event.target.value)}
            />
          </div>
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
                  value={toTimeInputValue(courtCloseTimes[court.name] ?? "24:00")}
                  onChange={(event) =>
                    setCourtCloseTimes((previous) => ({
                      ...previous,
                      [court.name]: fromTimeInputValue(event.target.value),
                    }))
                  }
                />
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            00:00 means open until midnight (no cutoff except the Fri/Sat rule above).
          </p>
        </div>

        <Button type="button" size="sm" disabled={isPending} onClick={handleSave} className="self-start">
          {isPending ? "Saving…" : "Save court hours"}
        </Button>
      </CardContent>
    </Card>
  );
}
