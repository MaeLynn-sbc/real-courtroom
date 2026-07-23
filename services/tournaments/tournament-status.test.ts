import { canTransitionTournamentStatus } from "@/services/tournaments/tournament-status";

describe("canTransitionTournamentStatus", () => {
  it("allows the documented forward path", () => {
    expect(canTransitionTournamentStatus("DRAFT", "REGISTRATION_OPEN")).toBe(true);
    expect(canTransitionTournamentStatus("REGISTRATION_OPEN", "REGISTRATION_CLOSED")).toBe(true);
    expect(canTransitionTournamentStatus("REGISTRATION_CLOSED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionTournamentStatus("IN_PROGRESS", "COMPLETED")).toBe(true);
  });

  it("allows cancellation from any non-terminal status", () => {
    expect(canTransitionTournamentStatus("DRAFT", "CANCELLED")).toBe(true);
    expect(canTransitionTournamentStatus("REGISTRATION_OPEN", "CANCELLED")).toBe(true);
    expect(canTransitionTournamentStatus("REGISTRATION_CLOSED", "CANCELLED")).toBe(true);
    expect(canTransitionTournamentStatus("IN_PROGRESS", "CANCELLED")).toBe(true);
  });

  it("rejects transitions out of terminal statuses", () => {
    expect(canTransitionTournamentStatus("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canTransitionTournamentStatus("CANCELLED", "DRAFT")).toBe(false);
  });

  it("rejects skipping states", () => {
    expect(canTransitionTournamentStatus("DRAFT", "IN_PROGRESS")).toBe(false);
    expect(canTransitionTournamentStatus("DRAFT", "COMPLETED")).toBe(false);
  });

  it("rejects a no-op transition to the same status", () => {
    expect(canTransitionTournamentStatus("DRAFT", "DRAFT")).toBe(false);
  });
});
