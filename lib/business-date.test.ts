import {
  assertIsCurrentBusinessDate,
  computeBusinessDate,
  getBusinessDateRange,
  StaleBusinessDateError,
  widenToBusinessDateRangeStart,
} from "@/lib/business-date";

const ROLLOVER_HOUR = 3;

describe("computeBusinessDate", () => {
  // BUILD-SPEC.md §0's required test, verbatim: a booking at 11:30PM
  // Friday and one at 12:30AM Saturday must both report under Friday's
  // business date.
  it("groups an 11:30PM Friday booking and a 12:30AM Saturday booking under the same (Friday) business date", () => {
    const fridayNight = new Date(2026, 6, 24, 23, 30); // Fri Jul 24 2026, 11:30 PM
    const saturdayEarly = new Date(2026, 6, 25, 0, 30); // Sat Jul 25 2026, 12:30 AM

    const fridayBusinessDate = computeBusinessDate(fridayNight, ROLLOVER_HOUR);
    const saturdayBusinessDate = computeBusinessDate(saturdayEarly, ROLLOVER_HOUR);

    expect(fridayBusinessDate).toEqual(new Date(2026, 6, 24));
    expect(saturdayBusinessDate).toEqual(new Date(2026, 6, 24));
  });

  it("keeps a timestamp at or after the rollover hour on its own calendar date", () => {
    const justAfterRollover = new Date(2026, 6, 25, 3, 0);
    expect(computeBusinessDate(justAfterRollover, ROLLOVER_HOUR)).toEqual(new Date(2026, 6, 25));
  });

  it("rolls a timestamp just before the rollover hour back to the previous calendar date", () => {
    const justBeforeRollover = new Date(2026, 6, 25, 2, 59);
    expect(computeBusinessDate(justBeforeRollover, ROLLOVER_HOUR)).toEqual(new Date(2026, 6, 24));
  });
});

describe("widenToBusinessDateRangeStart", () => {
  // Real incident (2026-08-12): "Open Play (regular)" read PHP 4,975
  // against real Sale rows that only totalled PHP 1,220 for the actual
  // business date — computeBusinessDate was being re-applied to a
  // range.from that was ALREADY an exact business-date value (midnight),
  // rolling it back a second, extra day.
  it("returns an already-exact-midnight input completely unchanged, even though its hour (0) is below the rollover hour", () => {
    const alreadyBusinessDate = new Date(2026, 7, 12); // Aug 12, exact midnight
    expect(widenToBusinessDateRangeStart(alreadyBusinessDate, ROLLOVER_HOUR)).toEqual(
      new Date(2026, 7, 12),
    );
  });

  it("still widens a genuinely raw, non-midnight timestamp down to its own business date (same as computeBusinessDate)", () => {
    const rawNarrowWindowStart = new Date(2026, 7, 12, 21, 30); // "an hour ago", 9:30 PM
    expect(widenToBusinessDateRangeStart(rawNarrowWindowStart, ROLLOVER_HOUR)).toEqual(
      new Date(2026, 7, 12),
    );
  });

  it("still rolls a raw, non-midnight, pre-rollover timestamp back to the previous business date", () => {
    const rawJustBeforeRollover = new Date(2026, 7, 12, 2, 30); // 2:30 AM, before the 3 AM rollover
    expect(widenToBusinessDateRangeStart(rawJustBeforeRollover, ROLLOVER_HOUR)).toEqual(
      new Date(2026, 7, 11),
    );
  });
});

describe("getBusinessDateRange", () => {
  it("returns the [rollover-to-rollover) window for a business date", () => {
    const { start, end } = getBusinessDateRange(new Date(2026, 6, 24), ROLLOVER_HOUR);
    expect(start).toEqual(new Date(2026, 6, 24, 3, 0, 0, 0));
    expect(end).toEqual(new Date(2026, 6, 25, 3, 0, 0, 0));
  });

  it("contains both the 11:30PM and 12:30AM timestamps from the required test", () => {
    const { start, end } = getBusinessDateRange(new Date(2026, 6, 24), ROLLOVER_HOUR);
    const fridayNight = new Date(2026, 6, 24, 23, 30);
    const saturdayEarly = new Date(2026, 6, 25, 0, 30);

    expect(fridayNight >= start && fridayNight < end).toBe(true);
    expect(saturdayEarly >= start && saturdayEarly < end).toBe(true);
  });
});

describe("assertIsCurrentBusinessDate", () => {
  // Owner incident (2026-08-11): a staff tab stuck on yesterday's date
  // silently wrote a whole day's worth of real registrations and court
  // groups under the wrong business date — invisible everywhere that
  // correctly queries today. This guard is the fix.
  it("passes silently when the date matches today's real business date", () => {
    const now = new Date(2026, 7, 11, 19, 0); // Aug 11, 7:00 PM
    const today = computeBusinessDate(now, ROLLOVER_HOUR);
    expect(() => assertIsCurrentBusinessDate(today, ROLLOVER_HOUR, now)).not.toThrow();
  });

  it("throws when the date is a real day behind (the reported incident)", () => {
    const now = new Date(2026, 7, 11, 19, 0); // Aug 11, 7:00 PM
    const yesterday = new Date(2026, 7, 10); // the stale tab's date
    expect(() => assertIsCurrentBusinessDate(yesterday, ROLLOVER_HOUR, now)).toThrow(
      StaleBusinessDateError,
    );
  });

  it("still passes for a legitimate post-midnight, pre-rollover action", () => {
    // 1:00 AM Saturday, rollover hour 3 — this genuinely still belongs
    // to Friday's business date (BUILD-SPEC.md §0), not a stale-tab bug.
    const now = new Date(2026, 6, 25, 1, 0);
    const fridayBusinessDate = new Date(2026, 6, 24);
    expect(() => assertIsCurrentBusinessDate(fridayBusinessDate, ROLLOVER_HOUR, now)).not.toThrow();
  });
});
