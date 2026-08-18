import {
  resolveDateRange,
  resolveDateRangeFromSearchParams,
} from "@/services/analytics/date-range";

// rolloverHour is now a REQUIRED parameter (it used to default to 0).
// These cases predate the rollover concept and assert plain
// midnight-boundary behaviour, so 0 is the assumption they were written
// against — stated here instead of inherited from a default. The cases
// that genuinely exercise the rollover pass 3 explicitly, below.
const TEST_ROLLOVER_HOUR = 0;

describe("resolveDateRange", () => {
  const now = new Date(2026, 6, 20, 15, 30); // Jul 20, 2026, 3:30pm

  it("TODAY starts at midnight of the current day when rolloverHour is 0", () => {
    const result = resolveDateRange("TODAY", undefined, now, TEST_ROLLOVER_HOUR);
    expect(result.from).toEqual(new Date(2026, 6, 20, 0, 0, 0, 0));
    expect(result.to).toEqual(now);
  });

  // Owner-directed consolidation (2026-08-12): "the attendant dashboard
  // resetting mid-shift" — TODAY must use computeBusinessDate, the same
  // rollover-hour logic every other correct part of the app already
  // uses, not literal midnight.
  it("TODAY starts at midnight of the current calendar day when now is after the rollover hour (no visible change from before)", () => {
    const afterRollover = new Date(2026, 6, 20, 9, 0); // 9am, rollover 3am
    const result = resolveDateRange("TODAY", undefined, afterRollover, 3);
    expect(result.from).toEqual(new Date(2026, 6, 20, 0, 0, 0, 0));
    expect(result.to).toEqual(afterRollover);
  });

  it("TODAY stays on the PREVIOUS calendar day's midnight when now is before the rollover hour (the actual fix)", () => {
    const beforeRollover = new Date(2026, 6, 21, 1, 30); // 1:30am, rollover 3am
    const result = resolveDateRange("TODAY", undefined, beforeRollover, 3);
    expect(result.from).toEqual(new Date(2026, 6, 20, 0, 0, 0, 0));
    expect(result.to).toEqual(beforeRollover);
  });

  it("7_DAYS goes back 7 days from now", () => {
    const result = resolveDateRange("7_DAYS", undefined, now, TEST_ROLLOVER_HOUR);
    expect(result.from).toEqual(new Date(2026, 6, 13, 15, 30));
    expect(result.to).toEqual(now);
  });

  it("30_DAYS goes back 30 days from now", () => {
    const result = resolveDateRange("30_DAYS", undefined, now, TEST_ROLLOVER_HOUR);
    expect(result.from).toEqual(new Date(2026, 5, 20, 15, 30));
    expect(result.to).toEqual(now);
  });

  it("90_DAYS goes back 90 days from now", () => {
    const result = resolveDateRange("90_DAYS", undefined, now, TEST_ROLLOVER_HOUR);
    expect(result.from).toEqual(new Date(2026, 3, 21, 15, 30));
    expect(result.to).toEqual(now);
  });

  it("CUSTOM uses the provided from/to", () => {
    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 0, 31);
    const result = resolveDateRange("CUSTOM", { from, to }, now, TEST_ROLLOVER_HOUR);
    expect(result).toEqual({ from, to });
  });

  it("CUSTOM without a custom range falls back to 30 days", () => {
    const result = resolveDateRange("CUSTOM", undefined, now, TEST_ROLLOVER_HOUR);
    expect(result.from).toEqual(new Date(2026, 5, 20, 15, 30));
    expect(result.to).toEqual(now);
  });
});

describe("resolveDateRangeFromSearchParams", () => {
  it("defaults to 30_DAYS when no preset is given", () => {
    const result = resolveDateRangeFromSearchParams({}, TEST_ROLLOVER_HOUR);
    expect(result.to.getTime() - result.from.getTime()).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -3);
  });

  it("parses a valid preset param", () => {
    const result = resolveDateRangeFromSearchParams({ preset: "7_DAYS" }, TEST_ROLLOVER_HOUR);
    expect(result.to.getTime() - result.from.getTime()).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -3);
  });

  it("falls back to 30_DAYS for an unrecognized preset value", () => {
    const result = resolveDateRangeFromSearchParams({ preset: "NOT_REAL" }, TEST_ROLLOVER_HOUR);
    expect(result.to.getTime() - result.from.getTime()).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -3);
  });

  it("uses from/to when preset is CUSTOM and both are present, parsed as local time", () => {
    // Reported live: new Date("2026-01-01") parses as UTC midnight,
    // which in a UTC+8 process is 8am local — cutting off virtually the
    // whole business day for a same-day range. from/to must resolve to
    // LOCAL midnight/end-of-day instead.
    const result = resolveDateRangeFromSearchParams({
      preset: "CUSTOM",
      from: "2026-01-01",
      to: "2026-01-31",
    }, TEST_ROLLOVER_HOUR);
    expect(result.from).toEqual(new Date(2026, 0, 1, 0, 0, 0, 0));
    expect(result.to).toEqual(new Date(2026, 0, 31, 23, 59, 59, 999));
  });

  it("a single-day custom range covers that entire day, not a zero-width instant", () => {
    const result = resolveDateRangeFromSearchParams({
      preset: "CUSTOM",
      from: "2026-08-01",
      to: "2026-08-01",
    }, TEST_ROLLOVER_HOUR);
    expect(result.from).toEqual(new Date(2026, 7, 1, 0, 0, 0, 0));
    expect(result.to).toEqual(new Date(2026, 7, 1, 23, 59, 59, 999));
    expect(result.to.getTime() - result.from.getTime()).toBeCloseTo(24 * 60 * 60 * 1000, -3);
  });

  it("ignores an array-valued search param", () => {
    const result = resolveDateRangeFromSearchParams({ preset: ["7_DAYS", "TODAY"] }, TEST_ROLLOVER_HOUR);
    expect(result.to.getTime() - result.from.getTime()).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -3);
  });

  it("threads rolloverHour through to a TODAY preset", () => {
    // 1:30am — before the 3am rollover, so business date is still
    // yesterday. Proves the rolloverHour argument actually reaches
    // resolveDateRange (which itself defaults `now` to `new Date()`),
    // using a fixed system time rather than the real clock, which
    // would make this test flaky depending on when it runs.
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 21, 1, 30));
    try {
      const result = resolveDateRangeFromSearchParams({ preset: "TODAY" }, 3);
      expect(result.from).toEqual(new Date(2026, 6, 20, 0, 0, 0, 0));
    } finally {
      jest.useRealTimers();
    }
  });
});
