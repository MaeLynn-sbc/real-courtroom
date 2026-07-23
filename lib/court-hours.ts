import type { CourtHoursSettings } from "@/features/cms/schemas/cms.schema";

// Pure functions over an admin-configured CourtHoursSettings (see
// services/settings/settings.service.ts's getCourtHours/setCourtHours,
// editable from the Website admin dashboard) — no DB access here, so
// callers fetch settings once and reuse it across many calls (e.g. the
// availability grid computes a window per cell without a query per cell).

function isFridayOrSaturday(date: Date): boolean {
  const day = date.getDay();
  return day === 5 || day === 6;
}

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export interface CourtBookingWindow {
  openMinutes: number;
  closeMinutes: number;
}

// A court with no entry in courtCloseTimes is open until midnight every
// day it isn't Friday/Saturday.
export function getCourtBookingWindow(
  settings: CourtHoursSettings,
  courtName: string,
  date: Date,
): CourtBookingWindow {
  const closeTime = isFridayOrSaturday(date)
    ? settings.fridaySaturdayCloseTime
    : (settings.courtCloseTimes[courtName] ?? "24:00");

  return {
    openMinutes: parseTimeToMinutes(settings.facilityOpenTime),
    closeMinutes: parseTimeToMinutes(closeTime),
  };
}

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

// Bookings are short (30min-2hr) and never cross midnight in practice, except
// landing exactly on it (a booking ending at 12:00 AM). That case's endAt
// falls on the next calendar day at 00:00, so it's special-cased to minute
// 1440 of startAt's day rather than minute 0.
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
  const endMinutes = endsAtNextMidnight ? 24 * 60 : minutesSinceMidnight(endAt);

  return startMinutes >= window.openMinutes && endMinutes <= window.closeMinutes;
}
