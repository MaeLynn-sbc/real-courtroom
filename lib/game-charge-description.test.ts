import { gameChargeDescription } from "./game-charge-description";

describe("gameChargeDescription", () => {
  it("reads court and time range", () => {
    expect(
      gameChargeDescription({
        courtName: "Court 1",
        startedAt: new Date(2026, 8, 17, 19, 20),
        endedAt: new Date(2026, 8, 17, 19, 40),
      }),
    ).toBe("OP · Court 1 · 7:20 PM–7:40 PM");
  });

  it("degrades gracefully when details are missing", () => {
    expect(gameChargeDescription({ courtName: "Court 2", startedAt: null, endedAt: null })).toBe("OP · Court 2");
    expect(gameChargeDescription({ courtName: null, startedAt: new Date(2026, 8, 17, 9, 5), endedAt: null })).toBe(
      "OP · from 9:05 AM",
    );
  });
});
