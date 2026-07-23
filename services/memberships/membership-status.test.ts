import { canTransitionMembershipStatus } from "@/services/memberships/membership-status";

describe("canTransitionMembershipStatus", () => {
  it("allows enrollment straight to active", () => {
    expect(canTransitionMembershipStatus("PENDING", "ACTIVE")).toBe(true);
  });

  it("allows an active membership to expire or be cancelled", () => {
    expect(canTransitionMembershipStatus("ACTIVE", "EXPIRED")).toBe(true);
    expect(canTransitionMembershipStatus("ACTIVE", "CANCELLED")).toBe(true);
  });

  it("allows renewing an expired membership back to active", () => {
    expect(canTransitionMembershipStatus("EXPIRED", "ACTIVE")).toBe(true);
  });

  it("allows reactivating a cancelled/suspended membership", () => {
    expect(canTransitionMembershipStatus("CANCELLED", "ACTIVE")).toBe(true);
  });

  it("rejects a cancelled membership expiring directly", () => {
    expect(canTransitionMembershipStatus("CANCELLED", "EXPIRED")).toBe(false);
  });

  it("rejects a no-op transition to the same status", () => {
    expect(canTransitionMembershipStatus("ACTIVE", "ACTIVE")).toBe(false);
  });
});
