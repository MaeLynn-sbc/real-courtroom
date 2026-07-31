import { isRegistrationOccupyingSeat } from "./open-play-seats";

const now = new Date("2026-08-01T20:00:00.000Z");

describe("isRegistrationOccupyingSeat", () => {
  it("counts a CONFIRMED registration", () => {
    expect(
      isRegistrationOccupyingSeat(
        { status: "CONFIRMED", waitlistPos: null, holdExpiresAt: null },
        now,
      ),
    ).toBe(true);
  });

  it("counts a PENDING_VERIFICATION registration", () => {
    expect(
      isRegistrationOccupyingSeat(
        { status: "PENDING_VERIFICATION", waitlistPos: null, holdExpiresAt: null },
        now,
      ),
    ).toBe(true);
  });

  it("counts a live AWAITING_PAYMENT hold", () => {
    const holdExpiresAt = new Date(now.getTime() + 60_000);
    expect(
      isRegistrationOccupyingSeat(
        { status: "AWAITING_PAYMENT", waitlistPos: null, holdExpiresAt },
        now,
      ),
    ).toBe(true);
  });

  it("does not count an expired AWAITING_PAYMENT hold", () => {
    const holdExpiresAt = new Date(now.getTime() - 1);
    expect(
      isRegistrationOccupyingSeat(
        { status: "AWAITING_PAYMENT", waitlistPos: null, holdExpiresAt },
        now,
      ),
    ).toBe(false);
  });

  it("does not count a walk-in waitlist row, regardless of status", () => {
    expect(
      isRegistrationOccupyingSeat(
        { status: "CONFIRMED", waitlistPos: 3, holdExpiresAt: null },
        now,
      ),
    ).toBe(false);
  });

  it("does not count a CANCELLED or REJECTED registration", () => {
    expect(
      isRegistrationOccupyingSeat(
        { status: "CANCELLED", waitlistPos: null, holdExpiresAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      isRegistrationOccupyingSeat(
        { status: "REJECTED", waitlistPos: null, holdExpiresAt: null },
        now,
      ),
    ).toBe(false);
  });
});
