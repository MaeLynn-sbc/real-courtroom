import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { coachAvailabilityService, type PublicCoachAvailability } from "@/services/coaching/coach-availability.service";

export const metadata: Metadata = {
  title: "Coach Availability",
  description: "See when our coaches are free over the next two weeks.",
};

export const dynamic = "force-dynamic";

// 14 days — "the next 7-14 days" from the ask, the wider end: a customer
// planning a lesson benefits more from seeing further out than from a
// tighter window.
const DAYS_AHEAD = 14;

const dayFormatter = new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "short", day: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });

function localDayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// A window can span past local midnight (a coach who set an overnight
// slot, however unlikely in practice) — split at each day boundary so
// grouping-by-day never silently drops the part of a window past
// midnight. Ordinary same-day windows pass through as a single segment.
function splitByDay(window: PublicCoachAvailability["windows"][number]): { dayKey: string; startAt: Date; endAt: Date }[] {
  const segments: { dayKey: string; startAt: Date; endAt: Date }[] = [];
  let cursor = window.startAt;
  while (cursor < window.endAt) {
    const dayEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    const segmentEnd = dayEnd < window.endAt ? dayEnd : window.endAt;
    segments.push({ dayKey: localDayKey(cursor), startAt: cursor, endAt: segmentEnd });
    cursor = segmentEnd;
  }
  return segments;
}

function groupByDay(coach: PublicCoachAvailability): { dayKey: string; label: string; ranges: { startAt: Date; endAt: Date }[] }[] {
  const byDay = new Map<string, { startAt: Date; endAt: Date }[]>();
  for (const window of coach.windows) {
    for (const segment of splitByDay(window)) {
      const existing = byDay.get(segment.dayKey) ?? [];
      existing.push({ startAt: segment.startAt, endAt: segment.endAt });
      byDay.set(segment.dayKey, existing);
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, ranges]) => ({
      dayKey,
      label: dayFormatter.format(ranges[0].startAt),
      ranges,
    }));
}

export default async function CoachAvailabilityPage() {
  const availability = await coachAvailabilityService.listPublicAvailability(DAYS_AHEAD);

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
        <div>
          <h1 className="font-heading text-4xl font-semibold tracking-tight">Coach Availability</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            When our coaches are free over the next two weeks. To book a lesson, add a coach when you book a
            court.
          </p>
        </div>

        {availability.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No open coaching times in the next {DAYS_AHEAD} days — check back later.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {availability.map((coach) => (
              <div key={coach.coachId} className="rounded-xl border p-4">
                <p className="font-heading mb-3 font-semibold">{coach.coachName}</p>
                <div className="flex flex-col gap-3">
                  {groupByDay(coach).map((day) => (
                    <div key={day.dayKey} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                      <p className="text-muted-foreground w-full shrink-0 text-sm font-medium sm:w-40">
                        {day.label}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {day.ranges.map((range, index) => (
                          <span
                            key={index}
                            className="border-success/40 bg-success/10 rounded-lg border px-2.5 py-1 text-sm"
                          >
                            {timeFormatter.format(range.startAt)} – {timeFormatter.format(range.endAt)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
