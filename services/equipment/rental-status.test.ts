import { canTransitionRentalStatus } from "@/services/equipment/rental-status";

describe("canTransitionRentalStatus", () => {
  it("allows an active rental to be returned, go overdue, or be lost", () => {
    expect(canTransitionRentalStatus("ACTIVE", "RETURNED")).toBe(true);
    expect(canTransitionRentalStatus("ACTIVE", "OVERDUE")).toBe(true);
    expect(canTransitionRentalStatus("ACTIVE", "LOST")).toBe(true);
  });

  it("allows an overdue rental to be returned or marked lost", () => {
    expect(canTransitionRentalStatus("OVERDUE", "RETURNED")).toBe(true);
    expect(canTransitionRentalStatus("OVERDUE", "LOST")).toBe(true);
  });

  it("rejects transitions out of terminal statuses", () => {
    expect(canTransitionRentalStatus("RETURNED", "ACTIVE")).toBe(false);
    expect(canTransitionRentalStatus("LOST", "ACTIVE")).toBe(false);
  });

  it("rejects a no-op transition to the same status", () => {
    expect(canTransitionRentalStatus("ACTIVE", "ACTIVE")).toBe(false);
  });
});
