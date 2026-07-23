import { calculateLockerDisplayStatus } from "@/services/lockers/locker-status";

const NOW = new Date(2026, 6, 20, 12, 0, 0);

describe("calculateLockerDisplayStatus", () => {
  it("returns MAINTENANCE regardless of rentals", () => {
    expect(
      calculateLockerDisplayStatus(
        "MAINTENANCE",
        [{ startAt: new Date(2026, 6, 20, 10, 0), endAt: new Date(2026, 6, 20, 14, 0) }],
        NOW,
      ),
    ).toBe("MAINTENANCE");
  });

  it("returns DISABLED regardless of rentals", () => {
    expect(calculateLockerDisplayStatus("DISABLED", [], NOW)).toBe("DISABLED");
  });

  it("returns OCCUPIED when an active rental currently covers now", () => {
    expect(
      calculateLockerDisplayStatus(
        "AVAILABLE",
        [{ startAt: new Date(2026, 6, 20, 10, 0), endAt: new Date(2026, 6, 20, 14, 0) }],
        NOW,
      ),
    ).toBe("OCCUPIED");
  });

  it("returns RESERVED when an active rental starts in the future", () => {
    expect(
      calculateLockerDisplayStatus(
        "AVAILABLE",
        [{ startAt: new Date(2026, 6, 21, 9, 0), endAt: new Date(2026, 6, 22, 9, 0) }],
        NOW,
      ),
    ).toBe("RESERVED");
  });

  it("returns AVAILABLE when no rentals cover now or the future", () => {
    expect(
      calculateLockerDisplayStatus(
        "AVAILABLE",
        [{ startAt: new Date(2026, 6, 10, 9, 0), endAt: new Date(2026, 6, 15, 9, 0) }],
        NOW,
      ),
    ).toBe("AVAILABLE");
  });

  it("returns AVAILABLE with no rentals at all", () => {
    expect(calculateLockerDisplayStatus("AVAILABLE", [], NOW)).toBe("AVAILABLE");
  });
});
