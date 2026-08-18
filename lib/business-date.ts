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

// Real incident (2026-08-12): computeBusinessDate is NOT idempotent
// when rolloverHour > 0 — its own output is always exact midnight
// (hours=0), and re-running computeBusinessDate on an already-midnight
// value sees "hours 0 < rolloverHour" and rolls it back ANOTHER full
// day. Several report queries (saleService.getSalesSummary, reporting.
// service.ts's dateAwareSaleWhere/getSalesByProductReport) filter
// Sale.businessDate against a range whose `.from` is SOMETIMES already
// a business-date value (resolveDateRange's TODAY/CUSTOM presets
// compute it via computeBusinessDate themselves) and SOMETIMES a
// genuinely raw timestamp that still needs widening down to its own
// business date (a multi-day preset's "N days ago right now", or an
// ad-hoc narrow window like "the last hour"). Blindly calling
// computeBusinessDate on `.from` in the first case silently summed an
// extra day's worth of sales into "today" — discovered live when
// "Open Play (regular)" read PHP 4,975 against real Sale rows that
// only totalled PHP 1,220 for the actual business date. Blindly using
// `.from` as-is in the second case broke any narrow, non-midnight
// window (Sale.businessDate is always midnight-valued, so a `gte`
// bound later than midnight the same day excludes that whole day).
// This is the safe version: an exact-midnight input is trusted as
// already business-date-correct and returned unchanged; anything else
// (a genuinely raw wall-clock reading) gets computeBusinessDate's usual
// widening treatment.
export function widenToBusinessDateRangeStart(timestamp: Date, rolloverHour: number): Date {
  const isExactMidnight =
    timestamp.getHours() === 0 &&
    timestamp.getMinutes() === 0 &&
    timestamp.getSeconds() === 0 &&
    timestamp.getMilliseconds() === 0;
  return isExactMidnight ? timestamp : computeBusinessDate(timestamp, rolloverHour);
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

// Does `timestamp` fall inside `date`'s own business day?
//
// Added for the reconciliation cutoff fix (owner decision 2026-08-18,
// option B). getExpectedEndingBalance passes the PREVIOUS day's
// confirmedAt to the sales query as a raw createdAt floor — the day is
// selected by businessDate but then filtered by a raw timestamp, two
// different axes. When a day is confirmed LATE that floor lands past the
// whole of the next day's trading and excludes every sale, so a fully
// populated day reports zero and cannot be closed. Seen in production:
// business date 2026-08-04 computed PHP 0.00 against PHP 4,580.00 of real
// cash sales, because 2026-08-03 was not confirmed until five days later.
//
// The cutoff is only meaningful when the previous day was closed within
// its OWN window — a timely close whose timestamp genuinely marks "this
// was already physically counted". A confirm days afterwards says nothing
// about what was in the drawer, so callers ignore it.
//
// Half-open [start, end), matching getBusinessDateRange, so a confirm at
// exactly the next day's rollover belongs to that next day, not this one.
// Shared rather than mirrored in each reconciliation service specifically
// so the cash and GCash twins cannot drift apart on it.
export function isWithinBusinessDay(timestamp: Date, date: Date, rolloverHour: number): boolean {
  const { start, end } = getBusinessDateRange(date, rolloverHour);
  return timestamp >= start && timestamp < end;
}
