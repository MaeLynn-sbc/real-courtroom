// The coach's own window inside a court booking.
//
// A CoachSession has no startAt/endAt of its own: it lives on the parent
// booking's court time (one source of truth for "when"). What it DOES
// own is how much of that court time is coached — `hours` — and where
// inside it the coaching sits — `startOffsetHours`, whole hours after
// the booking starts. Before this existed, every screen and the coach's
// own SMS showed the booking's FULL span while the fee (and the coach's
// pay) covered `hours`: a coach on a 2-hour court was told "5-7 PM",
// worked two hours, and was paid for one. Reported by the coach,
// 2026-09-13.
//
// Pure and Prisma-free so the public form, the staff pickers, the
// service's own validation and the SMS all derive the same window from
// the same two integers. Nothing else may compute a coach window.

export interface CoachSessionSpan {
  /** Whole hours after the booking starts that coaching begins. */
  startOffsetHours: number;
  /** Whole hours of coaching bought. */
  hours: number;
}

export interface TimeWindow {
  startAt: Date;
  endAt: Date;
}

const HOUR_MS = 3_600_000;

/** Whole hours a booking spans, never below 1 (a 30-minute booking still offers one coaching hour). */
export function bookingWholeHours(bookingStartAt: Date, bookingEndAt: Date): number {
  return Math.max(1, Math.floor((bookingEndAt.getTime() - bookingStartAt.getTime()) / HOUR_MS));
}

/** The coached window itself: booking start + offset, for `hours`. */
export function coachSessionWindow(bookingStartAt: Date, span: CoachSessionSpan): TimeWindow {
  const startAt = new Date(bookingStartAt.getTime() + span.startOffsetHours * HOUR_MS);
  return { startAt, endAt: new Date(startAt.getTime() + span.hours * HOUR_MS) };
}

/**
 * Does the coached window fit inside the court time? The server's real
 * guard: offsets and hours are money-adjacent fields on an
 * unauthenticated endpoint, so the picker's caps are convenience only.
 */
export function coachSpanFitsBooking(bookingStartAt: Date, bookingEndAt: Date, span: CoachSessionSpan): boolean {
  if (!Number.isInteger(span.startOffsetHours) || !Number.isInteger(span.hours)) return false;
  if (span.startOffsetHours < 0 || span.hours < 1) return false;
  return span.startOffsetHours + span.hours <= bookingWholeHours(bookingStartAt, bookingEndAt);
}

/**
 * Which start offsets are bookable for `hours` of coaching, given the
 * coach's free windows (stated availability minus other sessions,
 * already clipped by the caller or not — clipping is harmless here).
 * An offset qualifies only when its whole coached window sits inside ONE
 * free window: two adjacent free windows are never stitched together.
 */
export function coachStartOffsets(
  bookingStartAt: Date,
  bookingEndAt: Date,
  hours: number,
  freeWindows: TimeWindow[],
): number[] {
  const total = bookingWholeHours(bookingStartAt, bookingEndAt);
  const offsets: number[] = [];
  for (let offset = 0; offset + hours <= total; offset += 1) {
    const window = coachSessionWindow(bookingStartAt, { startOffsetHours: offset, hours });
    if (freeWindows.some((free) => free.startAt <= window.startAt && free.endAt >= window.endAt)) {
      offsets.push(offset);
    }
  }
  return offsets;
}

/** The longest coaching a coach can give inside this booking, 0 when no whole hour is free. */
export function maxCoachHours(bookingStartAt: Date, bookingEndAt: Date, freeWindows: TimeWindow[]): number {
  const total = bookingWholeHours(bookingStartAt, bookingEndAt);
  for (let hours = total; hours >= 1; hours -= 1) {
    if (coachStartOffsets(bookingStartAt, bookingEndAt, hours, freeWindows).length > 0) {
      return hours;
    }
  }
  return 0;
}

/**
 * Court-time windows minus booked ranges, left to right. Shared by the
 * availability service (a coach's stated windows minus their other
 * sessions) — extracted from there so the same subtraction is the one
 * the pickers reason about.
 */
export function subtractTimeWindows(range: TimeWindow, booked: TimeWindow[]): TimeWindow[] {
  let segments: TimeWindow[] = [range];
  for (const busy of booked) {
    const next: TimeWindow[] = [];
    for (const segment of segments) {
      if (busy.endAt <= segment.startAt || busy.startAt >= segment.endAt) {
        next.push(segment);
        continue;
      }
      if (busy.startAt > segment.startAt) next.push({ startAt: segment.startAt, endAt: busy.startAt });
      if (busy.endAt < segment.endAt) next.push({ startAt: busy.endAt, endAt: segment.endAt });
    }
    segments = next;
  }
  return segments;
}

const windowTimeFormatter = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });

/** "5:00 PM – 6:00 PM", the one way a coached window is written on screen. */
export function describeTimeWindow(window: TimeWindow): string {
  return `${windowTimeFormatter.format(window.startAt)} – ${windowTimeFormatter.format(window.endAt)}`;
}

/** Clip a window to a range; null when nothing is left. */
export function clipTimeWindow(window: TimeWindow, range: TimeWindow): TimeWindow | null {
  const startAt = window.startAt < range.startAt ? range.startAt : window.startAt;
  const endAt = window.endAt > range.endAt ? range.endAt : window.endAt;
  return endAt > startAt ? { startAt, endAt } : null;
}
