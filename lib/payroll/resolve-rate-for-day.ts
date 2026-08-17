// Which daily rate was in effect on a given day.
//
// EmployeeRate is append-only history (see its schema comment): a raise is
// a new row, never an edit, so a March change cannot alter February's
// computed pay. "In effect" therefore means the most recent row whose
// effectiveFrom is on or before the day being computed.
//
// Extracted from payroll-computation.service.ts, where it was a closure
// that took the caller's loop cursor at face value. That was correct only
// because the one caller happened to iterate from a midnight value — an
// unstated precondition a new Batch 3 caller could silently break by
// passing a real timestamp (a clock-in, "now") and getting yesterday's
// rate on a rate-change boundary day. Normalising here makes the guarantee
// belong to the function instead of to its callers.
//
// Pure — no Prisma import, unit-tested directly, same bar as compute-day.ts.

export interface RateInEffect {
  effectiveFrom: Date;
  dailyRateCents: number;
}

// Local calendar midnight, matching EmployeeRate.effectiveFrom's own
// convention and AttendanceRecord.workDate's. The suite pins
// TZ=Asia/Manila (jest.config.ts) so "local" is unambiguous.
function toMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// `rates` may be in any order; sorted defensively rather than relying on
// the caller's orderBy. The cost is trivial (one employee's rate history)
// against a wrong-rate bug that would be near-invisible in a payslip.
export function resolveRateForDay(rates: RateInEffect[], date: Date): number | null {
  const target = toMidnight(date).getTime();
  const applicable = [...rates]
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())
    .find((rate) => toMidnight(rate.effectiveFrom).getTime() <= target);
  return applicable?.dailyRateCents ?? null;
}
