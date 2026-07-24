import { computeBusinessDate, getBusinessDateRange } from "@/lib/business-date";

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
