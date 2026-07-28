import { expandWindowToHours, mergeHoursIntoWindows } from "@/lib/hour-windows";

describe("mergeHoursIntoWindows", () => {
  it("merges contiguous hours into one window", () => {
    expect(mergeHoursIntoWindows([7, 8, 9])).toEqual([{ startHour: 7, endHour: 10 }]);
  });

  it("keeps non-contiguous hours as separate windows — the normal case this whole redesign is for", () => {
    expect(mergeHoursIntoWindows([7, 8, 18, 19, 20, 21])).toEqual([
      { startHour: 7, endHour: 9 },
      { startHour: 18, endHour: 22 },
    ]);
  });

  it("handles a single hour", () => {
    expect(mergeHoursIntoWindows([14])).toEqual([{ startHour: 14, endHour: 15 }]);
  });

  it("handles an empty list", () => {
    expect(mergeHoursIntoWindows([])).toEqual([]);
  });

  it("sorts and deduplicates unordered, repeated input", () => {
    expect(mergeHoursIntoWindows([9, 7, 8, 8, 7])).toEqual([{ startHour: 7, endHour: 10 }]);
  });

  it("does not merge across a real gap of exactly one hour", () => {
    expect(mergeHoursIntoWindows([7, 9])).toEqual([
      { startHour: 7, endHour: 8 },
      { startHour: 9, endHour: 10 },
    ]);
  });
});

describe("expandWindowToHours", () => {
  it("expands a window back to its individual hours", () => {
    expect(expandWindowToHours({ startHour: 7, endHour: 10 })).toEqual([7, 8, 9]);
  });

  it("expands a one-hour window to a single hour", () => {
    expect(expandWindowToHours({ startHour: 14, endHour: 15 })).toEqual([14]);
  });

  it("round-trips through mergeHoursIntoWindows for a non-contiguous set", () => {
    const hours = [7, 8, 18, 19, 20, 21];
    const windows = mergeHoursIntoWindows(hours);
    const roundTripped = windows.flatMap(expandWindowToHours);
    expect(roundTripped).toEqual(hours);
  });
});
