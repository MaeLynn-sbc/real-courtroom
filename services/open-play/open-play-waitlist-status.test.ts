import { canTransitionOpenPlayWaitlistEntryStatus } from "@/services/open-play/open-play-waitlist-status";

describe("canTransitionOpenPlayWaitlistEntryStatus", () => {
  it("allows the documented forward transitions", () => {
    expect(canTransitionOpenPlayWaitlistEntryStatus("WAITING", "INVITED")).toBe(true);
    expect(canTransitionOpenPlayWaitlistEntryStatus("INVITED", "CONVERTED")).toBe(true);
    expect(canTransitionOpenPlayWaitlistEntryStatus("INVITED", "EXPIRED")).toBe(true);
  });

  it("rejects an expired invite returning to WAITING (the default assumption — no second chance)", () => {
    expect(canTransitionOpenPlayWaitlistEntryStatus("EXPIRED", "WAITING")).toBe(false);
  });

  it("rejects transitions out of terminal statuses", () => {
    expect(canTransitionOpenPlayWaitlistEntryStatus("EXPIRED", "INVITED")).toBe(false);
    expect(canTransitionOpenPlayWaitlistEntryStatus("CONVERTED", "INVITED")).toBe(false);
    expect(canTransitionOpenPlayWaitlistEntryStatus("CONVERTED", "WAITING")).toBe(false);
  });

  it("rejects skipping straight from WAITING to a terminal status", () => {
    expect(canTransitionOpenPlayWaitlistEntryStatus("WAITING", "CONVERTED")).toBe(false);
    expect(canTransitionOpenPlayWaitlistEntryStatus("WAITING", "EXPIRED")).toBe(false);
  });

  it("rejects a no-op transition to the same status", () => {
    expect(canTransitionOpenPlayWaitlistEntryStatus("WAITING", "WAITING")).toBe(false);
    expect(canTransitionOpenPlayWaitlistEntryStatus("INVITED", "INVITED")).toBe(false);
  });
});
