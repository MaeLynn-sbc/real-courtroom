import type { Metadata } from "next";

import { OpenPlaySchedulePanel } from "@/features/cms/components/open-play-schedule-panel";
import { computeBusinessDate } from "@/lib/business-date";
import { getCourtBookingWindow, getFacilityCloseMinutes } from "@/lib/court-hours";
import { courtService } from "@/services/court/court.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Open Play Schedule",
};

export const dynamic = "force-dynamic";

// Owner (2026-10-01): "it should be for court 1, 2 and 3".
const SCHEDULED_COURT_NAMES = ["Court 1", "Court 2", "Court 3"];

const dateHeadingFormatter = new Intl.DateTimeFormat("en-PH", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export default async function OpenPlaySchedulePage() {
  const [courts, courtHours] = await Promise.all([courtService.listCourts(), settingsService.getCourtHours()]);
  const today = computeBusinessDate(new Date(), courtHours.businessDateRolloverHour);

  const courtNames = SCHEDULED_COURT_NAMES.filter((name) =>
    courts.some((court) => court.name === name && court.status !== "DISABLED"),
  );

  const startHour = Math.floor(Number(courtHours.facilityOpenTime.slice(0, 2)));
  const latestCloseMinutes = Math.max(
    ...Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(today);
      date.setDate(date.getDate() + offset);
      return getFacilityCloseMinutes(courtHours, date);
    }),
  );
  const hours = Array.from(
    { length: Math.ceil(latestCloseMinutes / 60) - startHour },
    (_, index) => startHour + index,
  );

  // A court with no saved schedule starts from what it does today under
  // its cutoffs, so the first save changes only what the owner touches.
  const initialOpenPlayHours = Object.fromEntries(
    courtNames.map((name) => {
      const saved = courtHours.openPlayHours?.[name];
      if (saved) {
        return [name, saved];
      }
      const window = getCourtBookingWindow(courtHours, name, today);
      return [name, hours.filter((hour) => (hour + 1) * 60 > window.closeMinutes)];
    }),
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Open Play Schedule</h1>
        <p className="text-muted-foreground text-sm">
          Today is {dateHeadingFormatter.format(today)}. Tap an hour to switch it between booking and open play.
          Saving applies this schedule every day.
        </p>
      </div>

      <OpenPlaySchedulePanel
        courtNames={courtNames}
        hours={hours}
        initialOpenPlayHours={initialOpenPlayHours}
        hasSavedSchedule={courtNames.every((name) => courtHours.openPlayHours?.[name] !== undefined)}
        fridaySaturdayCloseTime={courtHours.fridaySaturdayCloseTime}
      />
    </div>
  );
}
