import { calculateRenewalEndDate } from "@/services/memberships/renewal-calculator";

describe("calculateRenewalEndDate", () => {
  it("adds a month for MONTHLY, from the current end date, when renewed before expiry", () => {
    const currentEndDate = new Date(2026, 7, 20); // Aug 20, 2026
    const now = new Date(2026, 6, 20); // Jul 20, 2026 — well before expiry
    const result = calculateRenewalEndDate(currentEndDate, "MONTHLY", now);
    expect(result).toEqual(new Date(2026, 8, 20)); // Sep 20, 2026
  });

  it("adds 3 months for QUARTERLY", () => {
    const currentEndDate = new Date(2026, 7, 20);
    const now = new Date(2026, 6, 20);
    const result = calculateRenewalEndDate(currentEndDate, "QUARTERLY", now);
    expect(result).toEqual(new Date(2026, 10, 20)); // Nov 20, 2026
  });

  it("adds a year for ANNUAL", () => {
    const currentEndDate = new Date(2026, 7, 20);
    const now = new Date(2026, 6, 20);
    const result = calculateRenewalEndDate(currentEndDate, "ANNUAL", now);
    expect(result).toEqual(new Date(2027, 7, 20));
  });

  it("renews from today, not the stale end date, when already expired", () => {
    const currentEndDate = new Date(2026, 0, 1); // Jan 1, 2026 — long expired
    const now = new Date(2026, 6, 20); // Jul 20, 2026
    const result = calculateRenewalEndDate(currentEndDate, "MONTHLY", now);
    expect(result).toEqual(new Date(2026, 7, 20)); // Aug 20, 2026, not Feb 1
  });
});
