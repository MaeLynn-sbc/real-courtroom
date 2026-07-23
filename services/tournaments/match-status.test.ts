import { canTransitionMatchStatus, determineMatchWinner } from "@/services/tournaments/match-status";

describe("canTransitionMatchStatus", () => {
  it("allows the documented forward path", () => {
    expect(canTransitionMatchStatus("SCHEDULED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionMatchStatus("IN_PROGRESS", "COMPLETED")).toBe(true);
  });

  it("allows a walkover from either scheduled or in-progress", () => {
    expect(canTransitionMatchStatus("SCHEDULED", "WALKOVER")).toBe(true);
    expect(canTransitionMatchStatus("IN_PROGRESS", "WALKOVER")).toBe(true);
  });

  it("allows cancellation from either non-terminal status", () => {
    expect(canTransitionMatchStatus("SCHEDULED", "CANCELLED")).toBe(true);
    expect(canTransitionMatchStatus("IN_PROGRESS", "CANCELLED")).toBe(true);
  });

  it("rejects transitions out of terminal statuses", () => {
    expect(canTransitionMatchStatus("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canTransitionMatchStatus("CANCELLED", "SCHEDULED")).toBe(false);
    expect(canTransitionMatchStatus("WALKOVER", "SCHEDULED")).toBe(false);
  });

  it("rejects a no-op transition to the same status", () => {
    expect(canTransitionMatchStatus("SCHEDULED", "SCHEDULED")).toBe(false);
  });
});

describe("determineMatchWinner", () => {
  it("declares the team that won more sets the winner", () => {
    const scores = [
      { team1Score: 11, team2Score: 8 },
      { team1Score: 9, team2Score: 11 },
      { team1Score: 11, team2Score: 6 },
    ];
    expect(determineMatchWinner(scores, "A", "B")).toBe("A");
  });

  it("returns null when sets are tied (cannot decide a winner)", () => {
    const scores = [
      { team1Score: 11, team2Score: 8 },
      { team1Score: 9, team2Score: 11 },
    ];
    expect(determineMatchWinner(scores, "A", "B")).toBeNull();
  });

  it("returns null when no sets have been entered yet", () => {
    expect(determineMatchWinner([], "A", "B")).toBeNull();
  });

  it("returns team1Id immediately for a bye (team2Id is null)", () => {
    expect(determineMatchWinner([], "A", null)).toBe("A");
  });
});
