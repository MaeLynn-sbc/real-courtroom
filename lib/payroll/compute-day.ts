// Payroll Batch 2c. Pure — no Prisma import, unit-tested directly (same bar
// as services/export/export.service.ts's toCsv). Computes exactly one
// calendar day. The DB-touching orchestrator is
// services/payroll/payroll-computation.service.ts, which fetches the whole
// period's rows in three range queries and calls this once per day.
//
// Rule 10 (no rounding until the final displayed/summed total) — every
// value here stays an exact number; only the caller's final aggregate
// rounds. Rule 4 — this function and everything that calls it is
// read-only; nothing here writes to the database.

const MINUTES_PER_STANDARD_DAY = 480; // 8 hours
// Exported so the tests can express the grace period symbolically rather
// than hardcoding its peso value — see the "shifted day" test, whose whole
// point is that the residual it asserts IS this constant.
export const LATE_GRACE_MINUTES = 10;
const OT_MULTIPLIER = 1.25;
// Owner decision (2026-08-18): late minutes are deducted at the OT rate,
// NOT the base rate. Before this, late came off at bare perMinuteRate
// while OT was paid at 1.25x, so shifting a day earned MORE than working
// it as scheduled — scheduled 07:00-15:00 but worked 08:00-17:00 took home
// ₱505 against ₱480 for the same nine hours on time. Pricing both sides at
// the same multiplier means the hour skipped costs exactly what the hour
// added earns.
//
// Deliberately its own constant rather than an alias of OT_MULTIPLIER:
// the two are equal today by policy, not by definition, and every rate in
// this system is meant to become owner-editable. Aliasing would silently
// couple "what late costs" to "what overtime pays" the first time one of
// them is tuned.
export const LATE_DEDUCTION_MULTIPLIER = 1.25;
// Soft threshold only — the attendance form warns above this and still
// lets the entry through, because a genuinely long shift happens and
// blocking it would just teach staff to enter a wrong time instead. It
// exists to catch the typo the overnight auto-roll makes possible:
// entering 05:00 when 15:00 was meant silently becomes a 14-hour shift.
// Lives beside the pay rates because it is the same kind of number — a
// venue policy figure meant to become owner-editable, not a code detail.
export const LONG_SHIFT_WARNING_HOURS = 14;
const NIGHT_DIFF_MULTIPLIER = 0.1;
const NIGHT_DIFF_START_HOUR = 22; // 10:00 PM
const NIGHT_DIFF_END_HOUR = 6; // 6:00 AM the following day

export type DayFlagCode =
  | "MISSING_CLOCK_OUT"
  | "NO_ATTENDANCE_FOR_SCHEDULED_DAY"
  | "NO_SCHEDULE_FOR_WORKED_DAY"
  | "NO_RATE_IN_EFFECT"
  | "CORRECTED_AFTER_PERIOD_END"
  | "REST_DAY_OR_HOLIDAY_UNHANDLED";

export interface DayFlag {
  code: DayFlagCode;
  message: string;
}

export interface DayComputationInput {
  workDate: Date;
  scheduleAssignment: { scheduledStart: Date; scheduledEnd: Date } | null;
  attendanceRecord: { clockIn: Date; clockOut: Date | null; correctedAt: Date | null } | null;
  dailyRateCents: number | null;
  periodEndDate: Date;
  isMarkedDate: boolean;
}

export interface DayComputation {
  workDate: Date;
  regularMinutes: number;
  otMinutes: number;
  nightDiffMinutes: number;
  lateDeductedMinutes: number;
  undertimeMinutes: number;
  // The peso value of each component that dayGrossCents is built from —
  // basePayCents + otPayCents + nightDiffPayCents - lateDeductionCents
  // always equals dayGrossCents exactly (see compute-day.test.ts's own
  // consistency check). Exists so a payslip can show "why" a day's total
  // is what it is, not just the final number.
  basePayCents: number;
  otPayCents: number;
  nightDiffPayCents: number;
  lateDeductionCents: number;
  dayGrossCents: number;
  // A day with nothing to compute (MISSING_CLOCK_OUT, NO_RATE_IN_EFFECT, or
  // simply no schedule and no attendance) contributes 0 to the period
  // total and is shown as "—", never as a silent 0 that looks like a real
  // zero-pay day.
  excludedFromTotal: boolean;
  flags: DayFlag[];
}

function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60000;
}

// Overlap, in minutes, between [clockIn, clockOut) and the night
// differential window that starts at 22:00 on workDate and ends at 06:00
// the following day. A shift ending exactly at 22:00:00 has 0 minutes of
// overlap; one minute later, 1.
function nightDiffMinutesFor(workDate: Date, clockIn: Date, clockOut: Date): number {
  const windowStart = new Date(
    workDate.getFullYear(),
    workDate.getMonth(),
    workDate.getDate(),
    NIGHT_DIFF_START_HOUR,
  );
  const windowEnd = new Date(
    workDate.getFullYear(),
    workDate.getMonth(),
    workDate.getDate() + 1,
    NIGHT_DIFF_END_HOUR,
  );

  const overlapStart = Math.max(clockIn.getTime(), windowStart.getTime());
  const overlapEnd = Math.min(clockOut.getTime(), windowEnd.getTime());
  return Math.max(0, (overlapEnd - overlapStart) / 60000);
}

export function computeDay(input: DayComputationInput): DayComputation {
  const flags: DayFlag[] = [];

  if (input.dailyRateCents === null) {
    return {
      workDate: input.workDate,
      regularMinutes: 0,
      otMinutes: 0,
      nightDiffMinutes: 0,
      lateDeductedMinutes: 0,
      undertimeMinutes: 0,
      basePayCents: 0,
      otPayCents: 0,
      nightDiffPayCents: 0,
      lateDeductionCents: 0,
      dayGrossCents: 0,
      excludedFromTotal: true,
      flags: [
        {
          code: "NO_RATE_IN_EFFECT",
          message: "No pay rate is in effect for this employee on this day — excluded from the total.",
        },
      ],
    };
  }

  const perMinuteRate = input.dailyRateCents / MINUTES_PER_STANDARD_DAY;

  if (!input.attendanceRecord) {
    if (input.scheduleAssignment) {
      return {
        workDate: input.workDate,
        regularMinutes: 0,
        otMinutes: 0,
        nightDiffMinutes: 0,
        lateDeductedMinutes: 0,
        undertimeMinutes: 0,
        basePayCents: 0,
        otPayCents: 0,
        nightDiffPayCents: 0,
        lateDeductionCents: 0,
        dayGrossCents: 0,
        excludedFromTotal: false,
        flags: [
          {
            code: "NO_ATTENDANCE_FOR_SCHEDULED_DAY",
            message: "Scheduled but no attendance was recorded — paid ₱0 for this day.",
          },
        ],
      };
    }

    // Nothing scheduled, nothing worked — a genuine off day, no flags.
    return {
      workDate: input.workDate,
      regularMinutes: 0,
      otMinutes: 0,
      nightDiffMinutes: 0,
      lateDeductedMinutes: 0,
      undertimeMinutes: 0,
      basePayCents: 0,
      otPayCents: 0,
      nightDiffPayCents: 0,
      lateDeductionCents: 0,
      dayGrossCents: 0,
      excludedFromTotal: true,
      flags: [],
    };
  }

  if (!input.attendanceRecord.clockOut) {
    return {
      workDate: input.workDate,
      regularMinutes: 0,
      otMinutes: 0,
      nightDiffMinutes: 0,
      lateDeductedMinutes: 0,
      undertimeMinutes: 0,
      basePayCents: 0,
      otPayCents: 0,
      nightDiffPayCents: 0,
      lateDeductionCents: 0,
      dayGrossCents: 0,
      excludedFromTotal: true,
      flags: [
        {
          code: "MISSING_CLOCK_OUT",
          message: "No clock-out was recorded — excluded from the total, not treated as 0 hours worked.",
        },
      ],
    };
  }

  const { clockIn, clockOut, correctedAt } = input.attendanceRecord;
  const workedMinutes = minutesBetween(clockIn, clockOut);
  const regularMinutes = Math.min(workedMinutes, MINUTES_PER_STANDARD_DAY);
  const otMinutes = Math.max(0, workedMinutes - MINUTES_PER_STANDARD_DAY);
  const nightDiffMinutes = nightDiffMinutesFor(input.workDate, clockIn, clockOut);

  let lateDeductedMinutes = 0;
  let undertimeMinutes = 0;
  if (input.scheduleAssignment) {
    const lateRaw = Math.max(0, minutesBetween(input.scheduleAssignment.scheduledStart, clockIn));
    lateDeductedMinutes = Math.max(0, lateRaw - LATE_GRACE_MINUTES);
    const scheduledMinutes = minutesBetween(
      input.scheduleAssignment.scheduledStart,
      input.scheduleAssignment.scheduledEnd,
    );
    undertimeMinutes = Math.max(0, scheduledMinutes - workedMinutes);
  } else {
    flags.push({
      code: "NO_SCHEDULE_FOR_WORKED_DAY",
      message:
        "No schedule was set for this day, so late deduction was skipped. If this was a rest day or holiday, no premium was applied — verify manually.",
    });
  }

  if (input.isMarkedDate) {
    flags.push({
      code: "REST_DAY_OR_HOLIDAY_UNHANDLED",
      message: "Rest day or holiday — premium NOT applied, verify manually.",
    });
  }

  if (correctedAt && correctedAt > input.periodEndDate) {
    flags.push({
      code: "CORRECTED_AFTER_PERIOD_END",
      message: "This entry was corrected after the pay period ended.",
    });
  }

  // Undertime never reduces pay (owner override — "undertime is ok since
  // sometimes there's no more people in the court"); it's computed and
  // shown, contributing nothing to dayGrossCents.
  const basePayCents = input.dailyRateCents;
  const otPayCents = otMinutes * perMinuteRate * OT_MULTIPLIER;
  const nightDiffPayCents = nightDiffMinutes * perMinuteRate * NIGHT_DIFF_MULTIPLIER;
  const lateDeductionCents = lateDeductedMinutes * perMinuteRate * LATE_DEDUCTION_MULTIPLIER;
  const dayGrossCents = basePayCents + otPayCents + nightDiffPayCents - lateDeductionCents;

  return {
    workDate: input.workDate,
    regularMinutes,
    otMinutes,
    nightDiffMinutes,
    lateDeductedMinutes,
    undertimeMinutes,
    basePayCents,
    otPayCents,
    nightDiffPayCents,
    lateDeductionCents,
    dayGrossCents,
    excludedFromTotal: false,
    flags,
  };
}
