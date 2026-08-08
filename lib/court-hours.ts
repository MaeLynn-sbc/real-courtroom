import type { CourtHoursSettings } from "@/features/cms/schemas/cms.schema";

// Pure functions over an admin-configured CourtHoursSettings (see
// services/settings/settings.service.ts's getCourtHours/setCourtHours,
// editable from the Website admin dashboard) — no DB access here, so
// callers fetch settings once and reuse it across many calls (e.g. the
// availability grid computes a window per cell without a query per cell).

const MINUTES_PER_DAY = 24 * 60;

// Exported for dashboard-sidebar.tsx too — the Fri/Sat vs. weeknight
// split it needs to distinguish is the same weekday rule this file
// already had privately for court-hours purposes.
export function isFridayOrSaturday(date: Date): boolean {
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
//
// Owner request (2026-08-08): "sometimes we want open play at earlier
// times" — startTimeOverrideMinutes lets a SPECIFIC Fri/Sat date's cutoff
// win over the live fridaySaturdayCloseTime setting, real enforcement
// (not just display) since every caller of this function — the public/
// staff grids, both booking forms, and the Serializable-transaction
// gate inside createBooking — feeds straight into whether a court
// actually accepts a booking. Deliberately still a PURE function, no DB
// access here: callers resolve the override ONCE per page load/request
// via openPlayCapacityService.getStartTimeOverrideMinutes, same
// discipline this function's own top comment already establishes for
// `settings` itself (fetch once, reuse across every cell). Undefined
// (the default) means "no override, behave exactly as before this
// parameter existed" — every existing call site that doesn't pass it
// is completely unaffected.
export function getCourtBookingWindow(
  settings: CourtHoursSettings,
  courtName: string,
  date: Date,
  startTimeOverrideMinutes?: number,
): CourtBookingWindow {
  const facilityCloseMinutes = getFacilityCloseMinutes(settings, date);

  let courtCutoffMinutes: number | null;
  if (startTimeOverrideMinutes !== undefined) {
    courtCutoffMinutes = startTimeOverrideMinutes;
  } else if (isFridayOrSaturday(date)) {
    courtCutoffMinutes = parseCourtCutoffMinutes(settings.fridaySaturdayCloseTime);
  } else {
    courtCutoffMinutes = parseCourtCutoffMinutes(settings.courtCloseTimes[courtName] ?? "00:00");
  }

  const closeMinutes =
    courtCutoffMinutes === null
      ? facilityCloseMinutes
      : Math.min(courtCutoffMinutes, facilityCloseMinutes);

  return {
    openMinutes: parseTimeToMinutes(settings.facilityOpenTime),
    closeMinutes,
  };
}

// Reported live: Fri/Sat walk-in open-play registration was always
// routed to the P150 unlimited capacity system, at every hour of the
// day, because the page deciding this only ever checked the calendar
// date (Friday or Saturday), never whether Open Play had actually taken
// over the courts yet. Same cutoff this file's own getCourtBookingWindow
// already uses to close Fri/Sat courts early (fridaySaturdayCloseTime)
// — one source of truth for "when does Open Play take over," not a
// second guess at it. Non-Fri/Sat dates always return true: the
// regular/unlimited split doesn't apply outside Fri/Sat at all, so
// there's nothing to be "before." "00:00" here means midnight/end-of-day
// (parseFacilityCloseMinutes's own sentinel), deliberately NOT
// courtCutoffTime's "no cutoff at all" sentinel — disabling the early
// Fri/Sat court-booking cutoff must not also silently disable Fri/Sat
// unlimited capacity mode for the whole night.
// startTimeOverrideMinutes: same per-date override as
// getCourtBookingWindow — if Open Play genuinely starts earlier on this
// specific night, walk-in registration must switch to unlimited mode at
// that same earlier moment, not the (now stale) global default.
export function isBeforeFridaySaturdayOpenPlayCutoff(
  settings: CourtHoursSettings,
  date: Date,
  now: Date,
  startTimeOverrideMinutes?: number,
): boolean {
  if (!isFridayOrSaturday(date)) {
    return true;
  }
  const cutoffMinutes =
    startTimeOverrideMinutes ?? parseFacilityCloseMinutes(settings.fridaySaturdayCloseTime);
  const cutoff = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  cutoff.setHours(0, cutoffMinutes, 0, 0);
  return now.getTime() < cutoff.getTime();
}

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

// Bookings are short (30min-4hr) and never cross midnight in practice, except
// landing exactly on it (e.g. a booking ending at 12:00 AM on a day facility
// close resolves to midnight). That case's endAt falls on the next calendar
// day at 00:00, so it's special-cased to minute 1440 of startAt's day
// rather than minute 0.
export function isWithinCourtBookingWindow(
  settings: CourtHoursSettings,
  courtName: string,
  startAt: Date,
  endAt: Date,
  startTimeOverrideMinutes?: number,
): boolean {
  const window = getCourtBookingWindow(settings, courtName, startAt, startTimeOverrideMinutes);

  const startMinutes = minutesSinceMidnight(startAt);
  const endsAtNextMidnight =
    endAt.getTime() > startAt.getTime() &&
    endAt.getHours() === 0 &&
    endAt.getMinutes() === 0 &&
    endAt.getDate() !== startAt.getDate();
  const endMinutes = endsAtNextMidnight ? MINUTES_PER_DAY : minutesSinceMidnight(endAt);

  return startMinutes >= window.openMinutes && endMinutes <= window.closeMinutes;
}

// "bookedCoach" is a variant of "booked" (owner request, 2026-08-02),
// not an independent state — same overlap rule, same non-interactive
// behavior, only the cell's own colour/label distinguish it from a
// plain booking. See classifyCourtSlot below.
export type CourtSlotState =
  "unavailable" | "specialEvent" | "openPlay" | "past" | "booked" | "bookedCoach" | "available";

export interface CourtSlotRange {
  startAt: Date;
  endAt: Date;
  // Optional: maintenanceRanges pass no coach concept at all and don't
  // set these. Only bookedRanges' hasCoach/coachName are ever read.
  hasCoach?: boolean;
  // Owner request (2026-08-05): show which coach on the public grid's
  // "Coach" sub-label, not just the bare word. Coaches are already
  // public figures (photo/bio on /coaches) — unlike a customer's name,
  // there's no privacy reason to withhold this on the public grid.
  coachName?: string;
  // Owner request (2026-08-08): a maintenanceRanges entry created for a
  // special event (CourtMaintenance.kind === "SPECIAL_EVENT") needs its
  // own distinct public label ("Booked for special events") instead of
  // the generic "Unavailable" every other maintenance reason gets. Only
  // ever set on maintenanceRanges entries — bookedRanges never sets
  // this.
  isSpecialEvent?: boolean;
}

function rangesOverlap(slotStart: Date, slotEnd: Date, ranges: CourtSlotRange[]): boolean {
  return ranges.some((range) => slotStart < range.endAt && slotEnd > range.startAt);
}

function overlappingRangeHasCoach(
  slotStart: Date,
  slotEnd: Date,
  ranges: CourtSlotRange[],
): boolean {
  return ranges.some(
    (range) => slotStart < range.endAt && slotEnd > range.startAt && range.hasCoach,
  );
}

function overlappingRangeIsSpecialEvent(
  slotStart: Date,
  slotEnd: Date,
  ranges: CourtSlotRange[],
): boolean {
  return ranges.some(
    (range) => slotStart < range.endAt && slotEnd > range.startAt && range.isSpecialEvent,
  );
}

// Separate from classifyCourtSlot deliberately — that function's return
// type (a single CourtSlotState string) is also consumed by
// public-booking-form.tsx's time dropdown, which has no use for a coach
// name. Only the grid itself needs it.
export function overlappingRangeCoachName(
  slotStart: Date,
  slotEnd: Date,
  ranges: CourtSlotRange[],
): string | undefined {
  return ranges.find(
    (range) => slotStart < range.endAt && slotEnd > range.startAt && range.hasCoach,
  )?.coachName;
}

// Single shared definition of "past" for an hourly slot — used by the
// homepage grid (classifyCourtSlot below) and the /book time dropdown
// alike, so they can never disagree about which hours are still
// selectable.
export function isHourInThePast(slotStart: Date, now: number): boolean {
  return slotStart.getTime() <= now;
}

// One hour's state for one court on the public homepage grid. Order is
// load-bearing, found live: a real, active booking's already-elapsed
// hours were showing as generically "Past" instead of "Booked" —
// "past" was checked BEFORE "booked" in the original inline version of
// this logic, so an hour that was both past AND booked always lost to
// the past branch, and the booked check never ran. The TV display (a
// structurally different query — "what's the current booking for this
// court right now," not a per-hour classification) never had this bug
// because it has no competing "past" concept at all. Fixed here by
// checking booked BEFORE past — a booking that already happened (or is
// happening) is still meaningfully "booked," never generically "past."
// Maintenance and outside-the-booking-window (open play) both still
// take priority over booked, same as before — a booking can't
// genuinely overlap either of those in practice, but the order
// documents the real precedence. "Past" is deliberately checked LAST,
// so it only ever fires for a genuinely free, elapsed hour.
export function classifyCourtSlot(params: {
  hour: number;
  slotStart: Date;
  slotEnd: Date;
  now: number;
  window: CourtBookingWindow;
  maintenanceRanges: CourtSlotRange[];
  bookedRanges: CourtSlotRange[];
}): CourtSlotState {
  const { hour, slotStart, slotEnd, now, window, maintenanceRanges, bookedRanges } = params;
  if (rangesOverlap(slotStart, slotEnd, maintenanceRanges)) {
    return overlappingRangeIsSpecialEvent(slotStart, slotEnd, maintenanceRanges)
      ? "specialEvent"
      : "unavailable";
  }
  if (hour * 60 < window.openMinutes || (hour + 1) * 60 > window.closeMinutes) {
    return "openPlay";
  }
  if (rangesOverlap(slotStart, slotEnd, bookedRanges)) {
    return overlappingRangeHasCoach(slotStart, slotEnd, bookedRanges) ? "bookedCoach" : "booked";
  }
  if (isHourInThePast(slotStart, now)) {
    return "past";
  }
  return "available";
}
