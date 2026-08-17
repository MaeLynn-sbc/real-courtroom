import { resolveRateForDay, type RateInEffect } from "@/lib/payroll/resolve-rate-for-day";

// A raise landing mid-period: 400/day until 15 April, 500/day from then on.
const RATES: RateInEffect[] = [
  { effectiveFrom: new Date(2031, 3, 15), dailyRateCents: 50000 },
  { effectiveFrom: new Date(2031, 0, 1), dailyRateCents: 40000 },
];

describe("resolveRateForDay", () => {
  it("picks the rate in effect, not the newest one", () => {
    expect(resolveRateForDay(RATES, new Date(2031, 3, 14))).toBe(40000);
    expect(resolveRateForDay(RATES, new Date(2031, 3, 20))).toBe(50000);
  });

  it("treats effectiveFrom as inclusive — the change applies on its own day", () => {
    expect(resolveRateForDay(RATES, new Date(2031, 3, 15))).toBe(50000);
  });

  // The reason this function exists. As a closure it took the caller's loop
  // cursor at face value, which was correct only because that one caller
  // iterated from midnight. A Batch 3 caller passing a real timestamp — a
  // clock-in, or "now" — would have got the PREVIOUS rate on the boundary
  // day, underpaying by the difference for a full day and leaving nothing
  // obviously wrong on the payslip.
  it("normalises a non-midnight timestamp on the boundary day itself", () => {
    const middayOnRaiseDay = new Date(2031, 3, 15, 13, 45, 30, 500);
    expect(resolveRateForDay(RATES, middayOnRaiseDay)).toBe(50000);
  });

  it("normalises a non-midnight timestamp on the day before the raise", () => {
    const lateEveningBefore = new Date(2031, 3, 14, 23, 59, 59, 999);
    expect(resolveRateForDay(RATES, lateEveningBefore)).toBe(40000);
  });

  it("does not depend on the order the rates arrive in", () => {
    const shuffled = [...RATES].reverse();
    expect(resolveRateForDay(shuffled, new Date(2031, 3, 20))).toBe(50000);
    expect(resolveRateForDay(shuffled, new Date(2031, 3, 14))).toBe(40000);
  });

  it("returns null when no rate was yet in effect, rather than guessing one", () => {
    expect(resolveRateForDay(RATES, new Date(2030, 11, 31))).toBeNull();
    expect(resolveRateForDay([], new Date(2031, 3, 20))).toBeNull();
  });

  // A rate row stored with a stray time component must not shift the day it
  // takes effect on.
  it("normalises effectiveFrom too, not just the queried date", () => {
    const messy: RateInEffect[] = [
      { effectiveFrom: new Date(2031, 3, 15, 9, 30), dailyRateCents: 50000 },
      { effectiveFrom: new Date(2031, 0, 1), dailyRateCents: 40000 },
    ];
    // Midnight on the raise day is still ON the raise day, even though the
    // stored row carries 09:30.
    expect(resolveRateForDay(messy, new Date(2031, 3, 15))).toBe(50000);
  });
});
