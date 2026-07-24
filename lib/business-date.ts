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
