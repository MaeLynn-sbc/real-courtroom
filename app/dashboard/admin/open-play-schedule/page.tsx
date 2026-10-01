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

export default async function OpenPlaySchedulePage() {
  const [courts, courtHours] = await Promise.all([courtService.listCourts(), settingsService.getCourtHours()]);
  const today = computeBusinessDate(new Date(), courtHours.businessDateRolloverHour);

  const courtNames = SCHEDULED_COURT_NAMES.filter((name) =>
    courts.some((court) => court.name === name && court.status !== "DISABLED"),
  );

  // The next seven dates, one per weekday, starting today — only their
  // weekday matters to getCourtBookingWindow.
  const week = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(today);
    date.setDate(date.getDate() + offset);
    return date;
  });

  const startHour = Math.floor(Number(courtHours.facilityOpenTime.slice(0, 2)));
  const latestCloseMinutes = Math.max(...week.map((date) => getFacilityCloseMinutes(courtHours, date)));
  const hours = Array.from(
    { length: Math.ceil(latestCloseMinutes / 60) - startHour },
    (_, index) => startHour + index,
  );

  // A weekday/court with no saved schedule starts from what it does now
  // under its cutoffs (including the Wed/Thu exceptions), so the first
  // save changes only what the owner touches.
  const initialSchedule = Object.fromEntries(
    week.map((date) => {
      const dayKey = String(date.getDay());
      const byCourt = Object.fromEntries(
        courtNames.map((name) => {
          const saved = courtHours.openPlayHoursByWeekday?.[dayKey]?.[name];
          if (saved) {
            return [name, saved];
          }
          const window = getCourtBookingWindow(courtHours, name, date);
          return [name, hours.filter((hour) => (hour + 1) * 60 > window.closeMinutes)];
        }),
      );
      return [dayKey, byCourt];
    }),
  );

  const hasSavedSchedule = Object.keys(courtHours.openPlayHoursByWeekday ?? {}).length > 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Open Play Schedule</h1>
        <p className="text-muted-foreground text-sm">
          Pick a day, then tap an hour to switch it between booking and open play. Each day repeats every week. For a
          one-off date, use Block Courts.
        </p>
      </div>

      <OpenPlaySchedulePanel
        courtNames={courtNames}
        hours={hours}
        todayKey={String(today.getDay())}
        initialSchedule={initialSchedule}
        hasSavedSchedule={hasSavedSchedule}
        fridaySaturdayCloseTime={courtHours.fridaySaturdayCloseTime}
      />
    </div>
  );
}
