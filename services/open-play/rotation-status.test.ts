import { canTransitionQueueStatus } from "@/services/open-play/rotation-status";

describe("canTransitionQueueStatus", () => {
  it("allows the documented forward cycle", () => {
    expect(canTransitionQueueStatus("WAITING", "PLAYING")).toBe(true);
    expect(canTransitionQueueStatus("PLAYING", "RESTING")).toBe(true);
    expect(canTransitionQueueStatus("RESTING", "WAITING")).toBe(true);
  });

  it("rejects skipping a step in the cycle", () => {
    expect(canTransitionQueueStatus("WAITING", "RESTING")).toBe(false);
    expect(canTransitionQueueStatus("PLAYING", "WAITING")).toBe(false);
    expect(canTransitionQueueStatus("RESTING", "PLAYING")).toBe(false);
  });

  it("rejects a no-op transition to the same status", () => {
    expect(canTransitionQueueStatus("WAITING", "WAITING")).toBe(false);
  });
});
