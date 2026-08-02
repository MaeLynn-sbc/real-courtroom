import {
  resolveDateRange,
  resolveDateRangeFromSearchParams,
} from "@/services/analytics/date-range";

describe("resolveDateRange", () => {
  const now = new Date(2026, 6, 20, 15, 30); // Jul 20, 2026, 3:30pm

  it("TODAY starts at midnight of the current day", () => {
    const result = resolveDateRange("TODAY", undefined, now);
    expect(result.from).toEqual(new Date(2026, 6, 20, 0, 0, 0, 0));
    expect(result.to).toEqual(now);
  });

  it("7_DAYS goes back 7 days from now", () => {
    const result = resolveDateRange("7_DAYS", undefined, now);
    expect(result.from).toEqual(new Date(2026, 6, 13, 15, 30));
    expect(result.to).toEqual(now);
  });

  it("30_DAYS goes back 30 days from now", () => {
    const result = resolveDateRange("30_DAYS", undefined, now);
    expect(result.from).toEqual(new Date(2026, 5, 20, 15, 30));
    expect(result.to).toEqual(now);
  });

  it("90_DAYS goes back 90 days from now", () => {
    const result = resolveDateRange("90_DAYS", undefined, now);
    expect(result.from).toEqual(new Date(2026, 3, 21, 15, 30));
    expect(result.to).toEqual(now);
  });

  it("CUSTOM uses the provided from/to", () => {
    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 0, 31);
    const result = resolveDateRange("CUSTOM", { from, to }, now);
    expect(result).toEqual({ from, to });
  });

  it("CUSTOM without a custom range falls back to 30 days", () => {
    const result = resolveDateRange("CUSTOM", undefined, now);
    expect(result.from).toEqual(new Date(2026, 5, 20, 15, 30));
    expect(result.to).toEqual(now);
  });
});

describe("resolveDateRangeFromSearchParams", () => {
  it("defaults to 30_DAYS when no preset is given", () => {
    const result = resolveDateRangeFromSearchParams({});
    expect(result.to.getTime() - result.from.getTime()).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -3);
  });

  it("parses a valid preset param", () => {
    const result = resolveDateRangeFromSearchParams({ preset: "7_DAYS" });
    expect(result.to.getTime() - result.from.getTime()).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -3);
  });

  it("falls back to 30_DAYS for an unrecognized preset value", () => {
    const result = resolveDateRangeFromSearchParams({ preset: "NOT_REAL" });
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
    });
    expect(result.from).toEqual(new Date(2026, 0, 1, 0, 0, 0, 0));
    expect(result.to).toEqual(new Date(2026, 0, 31, 23, 59, 59, 999));
  });

  it("a single-day custom range covers that entire day, not a zero-width instant", () => {
    const result = resolveDateRangeFromSearchParams({
      preset: "CUSTOM",
      from: "2026-08-01",
      to: "2026-08-01",
    });
    expect(result.from).toEqual(new Date(2026, 7, 1, 0, 0, 0, 0));
    expect(result.to).toEqual(new Date(2026, 7, 1, 23, 59, 59, 999));
    expect(result.to.getTime() - result.from.getTime()).toBeCloseTo(24 * 60 * 60 * 1000, -3);
  });

  it("ignores an array-valued search param", () => {
    const result = resolveDateRangeFromSearchParams({ preset: ["7_DAYS", "TODAY"] });
    expect(result.to.getTime() - result.from.getTime()).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -3);
  });
});
