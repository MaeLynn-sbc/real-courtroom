import {
  computeDay,
  LATE_DEDUCTION_MULTIPLIER,
  LATE_GRACE_MINUTES,
  type DayComputationInput,
} from "@/lib/payroll/compute-day";

const WORK_DATE = new Date(2031, 3, 7); // Monday, distinct from other fixture dates this session.
const PERIOD_END = new Date(2031, 3, 15);
const DAILY_RATE_CENTS = 48000; // ₱480/day → ₱1/min, convenient round numbers.

function at(hour: number, minute = 0): Date {
  return new Date(WORK_DATE.getFullYear(), WORK_DATE.getMonth(), WORK_DATE.getDate(), hour, minute);
}

function baseInput(overrides: Partial<DayComputationInput> = {}): DayComputationInput {
  return {
    workDate: WORK_DATE,
    scheduleAssignment: { scheduledStart: at(7), scheduledEnd: at(15) },
    attendanceRecord: { clockIn: at(7), clockOut: at(15), correctedAt: null },
    dailyRateCents: DAILY_RATE_CENTS,
    periodEndDate: PERIOD_END,
    isMarkedDate: false,
    ...overrides,
  };
}

describe("computeDay — a plain on-time, full 8-hour day", () => {
  it("pays exactly the flat daily rate with no premiums or deductions", () => {
    const result = computeDay(baseInput());
    expect(result.dayGrossCents).toBe(DAILY_RATE_CENTS);
    expect(result.otMinutes).toBe(0);
    expect(result.nightDiffMinutes).toBe(0);
    expect(result.lateDeductedMinutes).toBe(0);
    expect(result.undertimeMinutes).toBe(0);
    expect(result.excludedFromTotal).toBe(false);
    expect(result.flags).toHaveLength(0);
  });

  it("reports the pay breakdown as base pay only, no OT/night-diff/late components", () => {
    const result = computeDay(baseInput());
    expect(result.basePayCents).toBe(DAILY_RATE_CENTS);
    expect(result.otPayCents).toBe(0);
    expect(result.nightDiffPayCents).toBe(0);
    expect(result.lateDeductionCents).toBe(0);
  });
});

// Owner decision (2026-08-18). Late used to be deducted at the base rate
// while OT was paid at 1.25x, so a shifted day earned MORE than a punctual
// one: scheduled 07:00-15:00 but worked 08:00-17:00 took home ₱505 against
// ₱480 for the same nine hours on time. Both sides are now priced at the
// same multiplier.
//
// These four pin the policy. Verified failing before the change:
// the shifted-day and late-without-OT cases both came out 1250 cents high.
describe("computeDay — late is deducted at the OT rate, not the base rate", () => {
  const PER_MINUTE_CENTS = DAILY_RATE_CENTS / 480; // 100 cents/min

  // THE policy test. Not an exact equality: the 10-minute grace is real and
  // unconditional, so an hour-shifted day loses 60 minutes but is charged
  // for only 50, while all 60 come back as OT. The gap is the grace itself,
  // priced at the same multiplier — it is the deliberate cost of having a
  // grace period at all, not slack in the calculation.
  it("a shifted day nets exactly the grace period, by design — nothing more", () => {
    const punctual = computeDay(baseInput());
    const shifted = computeDay(
      baseInput({
        attendanceRecord: { clockIn: at(8), clockOut: at(17), correctedAt: null },
      }),
    );

    expect(shifted.lateDeductedMinutes).toBe(50); // 60 late, less the 10-min grace
    expect(shifted.otMinutes).toBe(60); // 540 worked - 480

    const graceResidual = LATE_GRACE_MINUTES * PER_MINUTE_CENTS * LATE_DEDUCTION_MULTIPLIER;
    expect(shifted.dayGrossCents).toBe(punctual.dayGrossCents + graceResidual);

    // And the charged minutes cost precisely what the same number of
    // earned minutes pay — the actual point of the change.
    expect(shifted.lateDeductionCents).toBe(50 * PER_MINUTE_CENTS * LATE_DEDUCTION_MULTIPLIER);
  });

  it("leaves genuine OT on a punctual day untouched — full 1.25x, no deduction", () => {
    const result = computeDay(
      baseInput({ attendanceRecord: { clockIn: at(7), clockOut: at(17), correctedAt: null } }),
    );
    expect(result.lateDeductedMinutes).toBe(0);
    expect(result.lateDeductionCents).toBe(0);
    expect(result.otMinutes).toBe(120);
    expect(result.otPayCents).toBe(120 * PER_MINUTE_CENTS * 1.25);
    expect(result.dayGrossCents).toBe(DAILY_RATE_CENTS + 120 * PER_MINUTE_CENTS * 1.25);
  });

  it("still deducts nothing at all for lateness inside the 10-minute grace", () => {
    const result = computeDay(
      baseInput({ attendanceRecord: { clockIn: at(7, 10), clockOut: at(15), correctedAt: null } }),
    );
    expect(result.lateDeductedMinutes).toBe(0);
    expect(result.lateDeductionCents).toBe(0);
    expect(result.dayGrossCents).toBe(DAILY_RATE_CENTS);
  });

  // No OT to mask it, so this is where the rate change is plainly visible:
  // 50 minutes cost 6250 rather than the old 5000.
  it("deducts late at the OT rate even on a day with no overtime to offset it", () => {
    const result = computeDay(
      baseInput({ attendanceRecord: { clockIn: at(8), clockOut: at(15), correctedAt: null } }),
    );
    expect(result.otMinutes).toBe(0);
    expect(result.lateDeductedMinutes).toBe(50);
    expect(result.lateDeductionCents).toBe(50 * PER_MINUTE_CENTS * LATE_DEDUCTION_MULTIPLIER);
    expect(result.dayGrossCents).toBe(
      DAILY_RATE_CENTS - 50 * PER_MINUTE_CENTS * LATE_DEDUCTION_MULTIPLIER,
    );
  });
});

describe("computeDay — pay breakdown components sum to dayGrossCents", () => {
  // ₱480/day → ₱1/min (DAILY_RATE_CENTS's own comment) — chosen so every
  // component below is a clean, hand-checkable number. Scheduled
  // 14:00–22:00; clocked in 11 min late (1 min deducted past the 10-min
  // grace) and out at 22:41 — 510 worked minutes (30 min OT) with a
  // 41-minute overlap into the 22:00 night-diff window.
  it("computes base + OT (1.25x) + night-diff (10%) − late as separate peso lines, and they sum to dayGrossCents", () => {
    const result = computeDay(
      baseInput({
        scheduleAssignment: { scheduledStart: at(14), scheduledEnd: at(22) },
        attendanceRecord: { clockIn: at(14, 11), clockOut: at(22, 41), correctedAt: null },
      }),
    );
    expect(result.lateDeductedMinutes).toBe(1);
    expect(result.otMinutes).toBe(30);
    expect(result.nightDiffMinutes).toBe(41);
    // perMinuteRate is in CENTS: 48000 / 480 = 100 (₱1/min).
    expect(result.basePayCents).toBe(DAILY_RATE_CENTS);
    expect(result.otPayCents).toBe(30 * 100 * 1.25);
    expect(result.nightDiffPayCents).toBe(41 * 100 * 0.1);
    expect(result.lateDeductionCents).toBe(1 * 100 * LATE_DEDUCTION_MULTIPLIER); // 125 — late now priced at the OT rate
    expect(result.basePayCents + result.otPayCents + result.nightDiffPayCents - result.lateDeductionCents).toBe(
      result.dayGrossCents,
    );
  });
});

describe("computeDay — late grace period boundary", () => {
  it("deducts 0 minutes for exactly 10 minutes late", () => {
    const result = computeDay(
      baseInput({ attendanceRecord: { clockIn: at(7, 10), clockOut: at(15, 10), correctedAt: null } }),
    );
    expect(result.lateDeductedMinutes).toBe(0);
  });

  it("deducts exactly 1 minute for 11 minutes late", () => {
    const result = computeDay(
      baseInput({ attendanceRecord: { clockIn: at(7, 11), clockOut: at(15, 11), correctedAt: null } }),
    );
    expect(result.lateDeductedMinutes).toBe(1);
  });
});

describe("computeDay — night differential window boundary", () => {
  it("counts 0 night-diff minutes for a shift ending exactly at 22:00:00", () => {
    const result = computeDay(
      baseInput({
        scheduleAssignment: { scheduledStart: at(14), scheduledEnd: at(22) },
        attendanceRecord: { clockIn: at(14), clockOut: at(22), correctedAt: null },
      }),
    );
    expect(result.nightDiffMinutes).toBe(0);
  });

  it("counts 1 night-diff minute for a shift ending at 22:01", () => {
    const result = computeDay(
      baseInput({
        scheduleAssignment: { scheduledStart: at(14), scheduledEnd: at(22, 1) },
        attendanceRecord: { clockIn: at(14), clockOut: at(22, 1), correctedAt: null },
      }),
    );
    expect(result.nightDiffMinutes).toBe(1);
  });

  it("counts 0 night-diff minutes for a shift starting exactly at 06:00:00 the next morning boundary", () => {
    const result = computeDay(
      baseInput({
        scheduleAssignment: null,
        attendanceRecord: {
          clockIn: new Date(WORK_DATE.getFullYear(), WORK_DATE.getMonth(), WORK_DATE.getDate() + 1, 6),
          clockOut: new Date(WORK_DATE.getFullYear(), WORK_DATE.getMonth(), WORK_DATE.getDate() + 1, 7),
          correctedAt: null,
        },
      }),
    );
    expect(result.nightDiffMinutes).toBe(0);
  });
});

describe("computeDay — overtime threshold boundary", () => {
  it("counts 0 OT minutes for exactly 480 worked minutes", () => {
    const result = computeDay(
      baseInput({ attendanceRecord: { clockIn: at(7), clockOut: at(15), correctedAt: null } }),
    );
    expect(result.otMinutes).toBe(0);
  });

  it("counts exactly 1 OT minute for 481 worked minutes", () => {
    const result = computeDay(
      baseInput({ attendanceRecord: { clockIn: at(7), clockOut: at(15, 1), correctedAt: null } }),
    );
    expect(result.otMinutes).toBe(1);
    expect(result.regularMinutes).toBe(480);
  });
});

describe("computeDay — missing clock-out", () => {
  it("is excluded from the total, not silently treated as 0 hours worked", () => {
    const result = computeDay(
      baseInput({ attendanceRecord: { clockIn: at(7), clockOut: null, correctedAt: null } }),
    );
    expect(result.excludedFromTotal).toBe(true);
    expect(result.dayGrossCents).toBe(0);
    expect(result.flags.map((f) => f.code)).toEqual(["MISSING_CLOCK_OUT"]);
  });
});

describe("computeDay — no rate in effect", () => {
  it("is excluded from the total regardless of schedule/attendance", () => {
    const result = computeDay(baseInput({ dailyRateCents: null }));
    expect(result.excludedFromTotal).toBe(true);
    expect(result.flags.map((f) => f.code)).toEqual(["NO_RATE_IN_EFFECT"]);
  });
});

describe("computeDay — scheduled but absent", () => {
  it("pays 0 for the day, included in the total (not excluded) as a real zero", () => {
    const result = computeDay(baseInput({ attendanceRecord: null }));
    expect(result.excludedFromTotal).toBe(false);
    expect(result.dayGrossCents).toBe(0);
    expect(result.flags.map((f) => f.code)).toEqual(["NO_ATTENDANCE_FOR_SCHEDULED_DAY"]);
  });
});

describe("computeDay — neither scheduled nor worked", () => {
  it("is a quiet off day — excluded, no flags", () => {
    const result = computeDay(baseInput({ scheduleAssignment: null, attendanceRecord: null }));
    expect(result.excludedFromTotal).toBe(true);
    expect(result.flags).toHaveLength(0);
  });
});

describe("computeDay — undertime is computed but never deducted", () => {
  it("still pays the full flat daily rate when the employee leaves early", () => {
    const result = computeDay(
      baseInput({ attendanceRecord: { clockIn: at(7), clockOut: at(13), correctedAt: null } }),
    );
    expect(result.undertimeMinutes).toBe(120);
    expect(result.dayGrossCents).toBe(DAILY_RATE_CENTS);
  });
});

describe("computeDay — worked day with no schedule", () => {
  it("computes regular/OT/night-diff normally, forces late to 0, and flags NO_SCHEDULE_FOR_WORKED_DAY", () => {
    const result = computeDay(baseInput({ scheduleAssignment: null }));
    expect(result.lateDeductedMinutes).toBe(0);
    expect(result.undertimeMinutes).toBe(0);
    expect(result.dayGrossCents).toBe(DAILY_RATE_CENTS);
    expect(result.flags.map((f) => f.code)).toEqual(["NO_SCHEDULE_FOR_WORKED_DAY"]);
    expect(result.flags[0]?.message).toMatch(/rest day or holiday/i);
  });
});

describe("computeDay — marked rest day/holiday", () => {
  it("still computes at the plain daily rate but flags REST_DAY_OR_HOLIDAY_UNHANDLED", () => {
    const result = computeDay(baseInput({ isMarkedDate: true }));
    expect(result.dayGrossCents).toBe(DAILY_RATE_CENTS);
    expect(result.flags).toEqual([
      { code: "REST_DAY_OR_HOLIDAY_UNHANDLED", message: "Rest day or holiday — premium NOT applied, verify manually." },
    ]);
  });

  it("fires alongside NO_SCHEDULE_FOR_WORKED_DAY, not instead of it, when both conditions are true", () => {
    const result = computeDay(baseInput({ scheduleAssignment: null, isMarkedDate: true }));
    expect(result.flags.map((f) => f.code).sort()).toEqual(
      ["NO_SCHEDULE_FOR_WORKED_DAY", "REST_DAY_OR_HOLIDAY_UNHANDLED"].sort(),
    );
  });
});

describe("computeDay — correction after period end", () => {
  it("is informational only — the number is still shown, not excluded", () => {
    const result = computeDay(
      baseInput({
        attendanceRecord: { clockIn: at(7), clockOut: at(15), correctedAt: new Date(2031, 3, 20) },
      }),
    );
    expect(result.excludedFromTotal).toBe(false);
    expect(result.dayGrossCents).toBe(DAILY_RATE_CENTS);
    expect(result.flags.map((f) => f.code)).toEqual(["CORRECTED_AFTER_PERIOD_END"]);
  });
});
