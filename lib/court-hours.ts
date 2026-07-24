import type { CourtHoursSettings } from "@/features/cms/schemas/cms.schema";

// Pure functions over an admin-configured CourtHoursSettings (see
// services/settings/settings.service.ts's getCourtHours/setCourtHours,
// editable from the Website admin dashboard) — no DB access here, so
// callers fetch settings once and reuse it across many calls (e.g. the
// availability grid computes a window per cell without a query per cell).

const MINUTES_PER_DAY = 24 * 60;

function isFridayOrSaturday(date: Date): boolean {
  const day = date.getDay();
  return day === 5 || day === 6;
}

type WeekdayKey = keyof CourtHoursSettings["facilityCloseTimes"];

function weekdayKey(date: Date): WeekdayKey {
  return String(date.getDay()) as WeekdayKey;
}

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// A facility close of "00:00" means "closes at midnight" (end of the
// day), not "closes at the instant it opens" — the natural reading of a
// closing-time field, and a real case (e.g. a New Year's Eve session).
function parseFacilityCloseMinutes(time: string): number {
  return time === "00:00" ? MINUTES_PER_DAY : parseTimeToMinutes(time);
}

// "00:00" on a court's own cutoff is a different, unrelated sentinel
// (BUILD-SPEC.md §0): "no per-court cutoff" — the court simply runs until
// facility close instead. Returns null for that case.
function parseCourtCutoffMinutes(time: string): number | null {
  return time === "00:00" ? null : parseTimeToMinutes(time);
}

export interface CourtBookingWindow {
  openMinutes: number;
  closeMinutes: number;
}

// The building's own closing time for a given date's weekday — exported
// so display copy (e.g. the home page's "Open daily" stat) can describe
// the facility's actual hours instead of a hardcoded guess.
export function getFacilityCloseMinutes(settings: CourtHoursSettings, date: Date): number {
  return parseFacilityCloseMinutes(settings.facilityCloseTimes[weekdayKey(date)] ?? "23:00");
}

// Facility close (per weekday) is always the hard cap; a court's own
// cutoff (or the Fri/Sat all-courts cutoff) can only make the window
// narrower, never wider — see BUILD-SPEC.md §0 "Facility close is a
// PUBLIC limit, not a data limit."
export function getCourtBookingWindow(
  settings: CourtHoursSettings,
  courtName: string,
  date: Date,
): CourtBookingWindow {
  const facilityCloseMinutes = getFacilityCloseMinutes(settings, date);

  const courtCutoffTime = isFridayOrSaturday(date)
    ? settings.fridaySaturdayCloseTime
    : (settings.courtCloseTimes[courtName] ?? "00:00");
  const courtCutoffMinutes = parseCourtCutoffMinutes(courtCutoffTime);

  const closeMinutes =
    courtCutoffMinutes === null ? facilityCloseMinutes : Math.min(courtCutoffMinutes, facilityCloseMinutes);

  return {
    openMinutes: parseTimeToMinutes(settings.facilityOpenTime),
    closeMinutes,
  };
}

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

// Bookings are short (30min-2hr) and never cross midnight in practice, except
// landing exactly on it (e.g. a booking ending at 12:00 AM on a day facility
// close resolves to midnight). That case's endAt falls on the next calendar
// day at 00:00, so it's special-cased to minute 1440 of startAt's day
// rather than minute 0.
export function isWithinCourtBookingWindow(
  settings: CourtHoursSettings,
  courtName: string,
  startAt: Date,
  endAt: Date,
): boolean {
  const window = getCourtBookingWindow(settings, courtName, startAt);

  const startMinutes = minutesSinceMidnight(startAt);
  const endsAtNextMidnight =
    endAt.getTime() > startAt.getTime() &&
    endAt.getHours() === 0 &&
    endAt.getMinutes() === 0 &&
    endAt.getDate() !== startAt.getDate();
  const endMinutes = endsAtNextMidnight ? MINUTES_PER_DAY : minutesSinceMidnight(endAt);

  return startMinutes >= window.openMinutes && endMinutes <= window.closeMinutes;
}
