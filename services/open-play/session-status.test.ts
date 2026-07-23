import { canTransitionSessionStatus } from "@/services/open-play/session-status";

describe("canTransitionSessionStatus", () => {
  it("allows SCHEDULED to move to IN_PROGRESS or CANCELLED", () => {
    expect(canTransitionSessionStatus("SCHEDULED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionSessionStatus("SCHEDULED", "CANCELLED")).toBe(true);
  });

  it("allows IN_PROGRESS to move to COMPLETED or CANCELLED", () => {
    expect(canTransitionSessionStatus("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canTransitionSessionStatus("IN_PROGRESS", "CANCELLED")).toBe(true);
  });

  it("rejects transitions out of terminal states", () => {
    expect(canTransitionSessionStatus("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canTransitionSessionStatus("CANCELLED", "SCHEDULED")).toBe(false);
  });

  it("rejects a no-op transition to the same status", () => {
    expect(canTransitionSessionStatus("SCHEDULED", "SCHEDULED")).toBe(false);
  });

  it("rejects skipping straight from SCHEDULED to COMPLETED", () => {
    expect(canTransitionSessionStatus("SCHEDULED", "COMPLETED")).toBe(false);
  });
});
