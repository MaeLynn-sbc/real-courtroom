import { toDateValue } from "@/lib/date-value";

// jest.config pins TZ=Asia/Manila, the venue's own timezone — the same
// UTC+8 offset that made toISOString read back the previous day.
describe("toDateValue", () => {
  it("keeps a business date on its own day, where toISOString reads the day before", () => {
    const businessDate = new Date(2026, 8, 21); // Sep 21, local midnight
    expect(toDateValue(businessDate)).toBe("2026-09-21");
    // The bug this replaces, stated so nobody reintroduces it:
    expect(businessDate.toISOString().slice(0, 10)).toBe("2026-09-20");
  });

  it("pads single-digit months and days", () => {
    expect(toDateValue(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("holds through a whole day, including the last instant before midnight", () => {
    expect(toDateValue(new Date(2026, 8, 21, 0, 0, 0, 0))).toBe("2026-09-21");
    expect(toDateValue(new Date(2026, 8, 21, 23, 59, 59, 999))).toBe("2026-09-21");
  });

  it("rolls at local midnight, not at UTC midnight", () => {
    // 07:59 Manila is still the previous day in UTC; the label must not be.
    expect(toDateValue(new Date(2026, 8, 21, 7, 59))).toBe("2026-09-21");
  });

  it("handles a month and a year boundary", () => {
    expect(toDateValue(new Date(2026, 8, 30))).toBe("2026-09-30");
    expect(toDateValue(new Date(2026, 11, 31))).toBe("2026-12-31");
    expect(toDateValue(new Date(2027, 0, 1))).toBe("2027-01-01");
  });
});
