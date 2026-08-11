// BUILD-SPEC.md §0 "Business date vs calendar date" — a session running
// 11PM-1AM belongs to the night it started, not the calendar date it
// ended on. The business day runs from facility open until the rollover
// hour (default 3AM) the following calendar day; anything before the
// rollover belongs to the previous business date.
//
// Deliberately not a stored column on Booking — it's fully derived from
// startAt + the rollover-hour setting, so it can't drift out of sync if
// the setting changes, and every consumer (dashboard "today" filter now,
// payment totals/open-play grouping/TV display in later phases) reads
// the same source of truth instead of a value frozen at insert time.

export function computeBusinessDate(timestamp: Date, rolloverHour: number): Date {
  const businessDate = new Date(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate());
  if (timestamp.getHours() < rolloverHour) {
    businessDate.setDate(businessDate.getDate() - 1);
  }
  return businessDate;
}

// Owner incident (2026-08-11): a staff tab left open on a stale
// /open-play-capacity/[date] URL (or bookmark) kept writing real,
// live-right-now actions — walk-in check-ins, manual court groups —
// under YESTERDAY's business date. Every one of those rows was
// invisible on the TV display and on any freshly-loaded board for
// today, since those always query the real current business date. 20
// registrations across a whole day were affected before it was caught.
// This guard is the fix: called at the top of every write that
// represents "right now" (register a walk-in, propose/build/assign a
// court group) so a stale date fails loudly and immediately, instead
// of silently writing data nobody will ever see. Compares against
// computeBusinessDate's own output (rollover-hour aware), so a
// legitimate post-midnight, pre-rollover action still passes — only a
// date that's genuinely a different business day is rejected.
export class StaleBusinessDateError extends Error {
  constructor() {
    super(
      "This page is showing a different day than today — refresh the page (or go to today's date) and try again.",
    );
    this.name = "StaleBusinessDateError";
  }
}

export function assertIsCurrentBusinessDate(
  date: Date,
  rolloverHour: number,
  now: Date = new Date(),
): void {
  const today = computeBusinessDate(now, rolloverHour);
  if (date.getTime() !== today.getTime()) {
    throw new StaleBusinessDateError();
  }
}

// The real-timestamp range [start, end) that belongs to business date
// `date` — e.g. rolloverHour=3 turns "Friday" into
// [Fri 03:00, Sat 03:00), which is what a "today's bookings" query
// should filter startAt against instead of literal midnight-to-midnight.
export function getBusinessDateRange(date: Date, rolloverHour: number): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), rolloverHour, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}
