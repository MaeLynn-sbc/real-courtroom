import { matchCode, roundName } from "./public-elimination-bracket";

// `totalRounds` here is the LAST round's number (what the component passes
// as totalRounds - 1), so an 8-team draw with rounds 1..3 uses 3.
describe("roundName", () => {
  it("names an 8-team draw from the end, not by round number", () => {
    expect(roundName(1, 3)).toBe("Quarterfinals");
    expect(roundName(2, 3)).toBe("Semifinals");
    expect(roundName(3, 3)).toBe("Final");
  });

  it("names a 4-team draw correctly — round 2 is the FINAL here, not a semi", () => {
    expect(roundName(1, 2)).toBe("Semifinals");
    expect(roundName(2, 2)).toBe("Final");
  });

  it("handles a 16-team draw", () => {
    expect(roundName(1, 4)).toBe("Round of 16");
    expect(roundName(2, 4)).toBe("Quarterfinals");
    expect(roundName(4, 4)).toBe("Final");
  });

  it("falls back to a plain number deeper than the round of 16", () => {
    expect(roundName(1, 5)).toBe("Round 1");
  });
});

describe("matchCode", () => {
  it("numbers the quarterfinals QF1..QF4 in bracket order", () => {
    expect(matchCode(1, 0, 3)).toBe("QF1");
    expect(matchCode(1, 3, 3)).toBe("QF4");
  });

  it("numbers the semifinals SF1/SF2", () => {
    expect(matchCode(2, 0, 3)).toBe("SF1");
    expect(matchCode(2, 1, 3)).toBe("SF2");
  });

  it("leaves the final unnumbered — there is only one", () => {
    expect(matchCode(3, 0, 3)).toBe("FINAL");
  });

  it("matches the feed rule: slot (r+1, p) is fed by (r, 2p) and (r, 2p+1)", () => {
    // SF1 is fed by QF1 and QF2; SF2 by QF3 and QF4.
    expect(matchCode(1, 0 * 2, 3)).toBe("QF1");
    expect(matchCode(1, 0 * 2 + 1, 3)).toBe("QF2");
    expect(matchCode(1, 1 * 2, 3)).toBe("QF3");
    expect(matchCode(1, 1 * 2 + 1, 3)).toBe("QF4");
  });
});
