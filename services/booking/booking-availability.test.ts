import { hasTimeOverlap } from "@/services/booking/booking-availability";

describe("hasTimeOverlap", () => {
  const d = (hour: number, minute = 0) => new Date(2026, 6, 20, hour, minute);

  it("returns true when ranges fully overlap", () => {
    expect(hasTimeOverlap(d(9), d(11), d(9), d(11))).toBe(true);
  });

  it("returns true when ranges partially overlap", () => {
    expect(hasTimeOverlap(d(9), d(11), d(10), d(12))).toBe(true);
    expect(hasTimeOverlap(d(10), d(12), d(9), d(11))).toBe(true);
  });

  it("returns true when one range fully contains the other", () => {
    expect(hasTimeOverlap(d(9), d(12), d(10), d(11))).toBe(true);
  });

  it("returns false when ranges are back-to-back (touching, not overlapping)", () => {
    expect(hasTimeOverlap(d(9), d(10), d(10), d(11))).toBe(false);
    expect(hasTimeOverlap(d(10), d(11), d(9), d(10))).toBe(false);
  });

  it("returns false when ranges don't overlap at all", () => {
    expect(hasTimeOverlap(d(9), d(10), d(14), d(15))).toBe(false);
  });
});
