import { canTransitionLockerRentalStatus } from "@/services/lockers/locker-rental-status";

describe("canTransitionLockerRentalStatus", () => {
  it("allows an active rental to expire or be cancelled", () => {
    expect(canTransitionLockerRentalStatus("ACTIVE", "EXPIRED")).toBe(true);
    expect(canTransitionLockerRentalStatus("ACTIVE", "CANCELLED")).toBe(true);
  });

  it("rejects transitions out of terminal statuses", () => {
    expect(canTransitionLockerRentalStatus("EXPIRED", "ACTIVE")).toBe(false);
    expect(canTransitionLockerRentalStatus("CANCELLED", "ACTIVE")).toBe(false);
  });

  it("rejects a no-op transition to the same status", () => {
    expect(canTransitionLockerRentalStatus("ACTIVE", "ACTIVE")).toBe(false);
  });
});
