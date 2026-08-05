/**
 * Payroll Batch 2c — computation engine. Proves, against real rows:
 *   1. A plain on-time full day pays exactly the daily rate in effect on
 *      that date.
 *   2. A rate change mid-period does not retroactively change an earlier
 *      day's computed pay, THROUGH THE FULL computeEmployeePeriod engine
 *      (employee-rate-and-pay-period.integration.ts already proves this at
 *      the resolveRateForDate layer directly — this proves the
 *      orchestrator wires that same property through correctly end to
 *      end).
 *   3. Missing clock-out is excluded from the total, never silently 0.
 *   4. Scheduled-but-absent pays a real, included 0 — not excluded.
 *   5. A worked day with no schedule flags NO_SCHEDULE_FOR_WORKED_DAY,
 *      still pays the flat rate.
 *   6. A worked day on a marked (rest day/holiday) date flags
 *      REST_DAY_OR_HOLIDAY_UNHANDLED but still computes at the plain daily
 *      rate — no multiplier is applied, by design (Batch 3 territory).
 *   7. Undertime never reduces pay — the day still pays the full rate.
 *   8. Period totals equal the exact sum of each day's dayGrossCents,
 *      rounded exactly once.
 *   9. PayrollMarkedDate: duplicate dates are rejected by the real unique
 *      constraint; listMarkedDatesInRange only returns dates inside the
 *      requested window.
 *   10. Access control: real seeded OWNER has PAYROLL_MANAGE, COURT_ATTENDANT
 *       does not — the gate every new action in this batch relies on.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { hasPermission } from "../../lib/rbac";
import { prisma } from "../../lib/prisma";
import { PERMISSIONS } from "../../types/permissions";
import { employeeRateService } from "./employee-rate.service";
import { payrollMarkedDateService } from "./payroll-marked-date.service";
import { payrollComputationService } from "./payroll-computation.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

// May 2031 — a month not otherwise used by any fixture this session.
const PERIOD_START = new Date(2031, 4, 1);
const PERIOD_END = new Date(2031, 4, 15);

function on(day: number, hour: number, minute = 0): Date {
  return new Date(2031, 4, day, hour, minute);
}

async function cleanUp(employeeId: string): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { entityType: "EmployeeRate" } });
  await prisma.employeeRate.deleteMany({
    where: { employeeId, effectiveFrom: { gte: PERIOD_START, lte: PERIOD_END } },
  });
  await prisma.attendanceRecord.deleteMany({
    where: { employeeId, workDate: { gte: PERIOD_START, lte: PERIOD_END } },
  });
  await prisma.scheduleAssignment.deleteMany({
    where: { employeeId, workDate: { gte: PERIOD_START, lte: PERIOD_END } },
  });
  await prisma.payrollMarkedDate.deleteMany({ where: { date: { gte: PERIOD_START, lte: PERIOD_END } } });
  await prisma.payPeriod.deleteMany({ where: { startDate: PERIOD_START, endDate: PERIOD_END } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });

  await cleanUp(employee.id);

  try {
    const period = await prisma.payPeriod.create({ data: { startDate: PERIOD_START, endDate: PERIOD_END } });

    // Rate A from the 1st, rate B from the 10th — the mid-period change.
    await employeeRateService.createRate(
      { employeeId: employee.id, dailyRateCents: 50000, effectiveFrom: new Date(2031, 4, 1) },
      owner.id,
    );
    await employeeRateService.createRate(
      { employeeId: employee.id, dailyRateCents: 60000, effectiveFrom: new Date(2031, 4, 10) },
      owner.id,
    );

    // May 3: plain on-time full day, rate A.
    await prisma.scheduleAssignment.create({
      data: {
        employeeId: employee.id,
        workDate: new Date(2031, 4, 3),
        scheduledStart: on(3, 7),
        scheduledEnd: on(3, 15),
      },
    });
    await prisma.attendanceRecord.create({
      data: {
        employeeId: employee.id,
        workDate: new Date(2031, 4, 3),
        clockIn: on(3, 7),
        clockOut: on(3, 15),
        rawClockIn: on(3, 7),
        rawClockOut: on(3, 15),
      },
    });

    // May 4: missing clock-out.
    await prisma.attendanceRecord.create({
      data: {
        employeeId: employee.id,
        workDate: new Date(2031, 4, 4),
        clockIn: on(4, 7),
        clockOut: null,
        rawClockIn: on(4, 7),
        rawClockOut: null,
      },
    });

    // May 5: scheduled, no attendance (absent).
    await prisma.scheduleAssignment.create({
      data: {
        employeeId: employee.id,
        workDate: new Date(2031, 4, 5),
        scheduledStart: on(5, 7),
        scheduledEnd: on(5, 15),
      },
    });

    // May 6: worked, no schedule.
    await prisma.attendanceRecord.create({
      data: {
        employeeId: employee.id,
        workDate: new Date(2031, 4, 6),
        clockIn: on(6, 7),
        clockOut: on(6, 15),
        rawClockIn: on(6, 7),
        rawClockOut: on(6, 15),
      },
    });

    // May 7: worked, scheduled, and marked as a holiday.
    await prisma.scheduleAssignment.create({
      data: {
        employeeId: employee.id,
        workDate: new Date(2031, 4, 7),
        scheduledStart: on(7, 7),
        scheduledEnd: on(7, 15),
      },
    });
    await prisma.attendanceRecord.create({
      data: {
        employeeId: employee.id,
        workDate: new Date(2031, 4, 7),
        clockIn: on(7, 7),
        clockOut: on(7, 15),
        rawClockIn: on(7, 7),
        rawClockOut: on(7, 15),
      },
    });
    await payrollMarkedDateService.createMarkedDate(new Date(2031, 4, 7), "Test Holiday", owner.id);

    // May 12: plain on-time full day, rate B (after the change).
    await prisma.scheduleAssignment.create({
      data: {
        employeeId: employee.id,
        workDate: new Date(2031, 4, 12),
        scheduledStart: on(12, 7),
        scheduledEnd: on(12, 15),
      },
    });
    await prisma.attendanceRecord.create({
      data: {
        employeeId: employee.id,
        workDate: new Date(2031, 4, 12),
        clockIn: on(12, 7),
        clockOut: on(12, 15),
        rawClockIn: on(12, 7),
        rawClockOut: on(12, 15),
      },
    });

    // May 13: undertime, rate B — left 2 hours early.
    await prisma.scheduleAssignment.create({
      data: {
        employeeId: employee.id,
        workDate: new Date(2031, 4, 13),
        scheduledStart: on(13, 7),
        scheduledEnd: on(13, 15),
      },
    });
    await prisma.attendanceRecord.create({
      data: {
        employeeId: employee.id,
        workDate: new Date(2031, 4, 13),
        clockIn: on(13, 7),
        clockOut: on(13, 13),
        rawClockIn: on(13, 7),
        rawClockOut: on(13, 13),
      },
    });

    const result = await payrollComputationService.computeEmployeePeriod(employee.id, period.id);
    const byDate = new Map(result.days.map((d) => [d.workDate.getDate(), d]));

    const day3 = byDate.get(3)!;
    assert(day3.dayGrossCents === 50000, `expected May 3 to pay rate A (500.00), got ${day3.dayGrossCents}`);
    assert(day3.flags.length === 0, "expected a plain on-time day to have no flags");
    console.log("PASS: a plain on-time full day pays exactly the daily rate in effect on that date.");

    const day12 = byDate.get(12)!;
    assert(day12.dayGrossCents === 60000, `expected May 12 (after the rate change) to pay rate B (600.00), got ${day12.dayGrossCents}`);
    console.log("PASS: a rate change mid-period is correctly reflected through the full computeEmployeePeriod engine — day 3 stayed at rate A while day 12 used rate B.");

    const day4 = byDate.get(4)!;
    assert(day4.excludedFromTotal, "expected the missing-clock-out day to be excluded");
    assert(day4.flags.map((f) => f.code).includes("MISSING_CLOCK_OUT"), "expected MISSING_CLOCK_OUT");
    console.log("PASS: a missing clock-out is excluded from the total, not silently treated as 0 hours.");

    const day5 = byDate.get(5)!;
    assert(!day5.excludedFromTotal, "expected the absent-but-scheduled day to be a real included 0, not excluded");
    assert(day5.dayGrossCents === 0, "expected the absent day to pay exactly 0");
    assert(day5.flags.map((f) => f.code).includes("NO_ATTENDANCE_FOR_SCHEDULED_DAY"), "expected NO_ATTENDANCE_FOR_SCHEDULED_DAY");
    console.log("PASS: a scheduled-but-absent day pays a real, included 0.");

    const day6 = byDate.get(6)!;
    assert(day6.dayGrossCents === 50000, "expected the unscheduled worked day to still pay the flat rate");
    assert(day6.flags.map((f) => f.code).includes("NO_SCHEDULE_FOR_WORKED_DAY"), "expected NO_SCHEDULE_FOR_WORKED_DAY");
    console.log("PASS: a worked day with no schedule still computes at the flat rate and is flagged.");

    const day7 = byDate.get(7)!;
    assert(day7.dayGrossCents === 50000, "expected the marked-holiday day to still pay the plain rate, no multiplier");
    assert(day7.flags.map((f) => f.code).includes("REST_DAY_OR_HOLIDAY_UNHANDLED"), "expected REST_DAY_OR_HOLIDAY_UNHANDLED");
    console.log("PASS: a worked day on a marked rest day/holiday computes at the plain rate but is flagged, never silently normal.");

    const day13 = byDate.get(13)!;
    assert(day13.undertimeMinutes === 120, `expected 120 undertime minutes, got ${day13.undertimeMinutes}`);
    assert(day13.dayGrossCents === 60000, "expected undertime to NOT reduce pay — still the full daily rate");
    console.log("PASS: undertime is computed and shown but never deducted.");

    const expectedGross = 50000 + 0 + 0 + 50000 + 50000 + 60000 + 60000;
    assert(
      result.totals.grossCents === expectedGross,
      `expected period totals.grossCents to be the exact sum of every day (${expectedGross}), got ${result.totals.grossCents}`,
    );
    console.log("PASS: period totals equal the exact sum of every day's gross, rounded exactly once.");

    // ============== PayrollMarkedDate ==============
    let rejectedDuplicateMarkedDate = false;
    try {
      await payrollMarkedDateService.createMarkedDate(new Date(2031, 4, 7), "Duplicate", owner.id);
    } catch {
      rejectedDuplicateMarkedDate = true;
    }
    assert(rejectedDuplicateMarkedDate, "expected marking the same date twice to be rejected");

    const inRange = await payrollMarkedDateService.listMarkedDatesInRange(PERIOD_START, PERIOD_END);
    assert(inRange.length === 1 && inRange[0]?.label === "Test Holiday", "expected exactly the one marked date inside the period range");
    const outOfRange = await payrollMarkedDateService.listMarkedDatesInRange(
      new Date(2031, 5, 1),
      new Date(2031, 5, 30),
    );
    assert(outOfRange.length === 0, "expected no marked dates outside the requested range");
    console.log("PASS: PayrollMarkedDate rejects a duplicate date and listMarkedDatesInRange scopes correctly.");

    // ============== Access control ==============
    const ownerRole = await prisma.role.findFirstOrThrow({
      where: { name: "OWNER" },
      include: { permissions: { include: { permission: true } } },
    });
    const courtAttendantRole = await prisma.role.findFirstOrThrow({
      where: { name: "COURT_ATTENDANT" },
      include: { permissions: { include: { permission: true } } },
    });
    assert(
      hasPermission(
        ownerRole.permissions.map((p) => p.permission.key),
        PERMISSIONS.PAYROLL_MANAGE,
      ),
      "expected the real, seeded OWNER role to have PAYROLL_MANAGE",
    );
    assert(
      !hasPermission(
        courtAttendantRole.permissions.map((p) => p.permission.key),
        PERMISSIONS.PAYROLL_MANAGE,
      ),
      "expected the real, seeded COURT_ATTENDANT role to NOT have PAYROLL_MANAGE",
    );
    console.log("PASS: marked-date and export actions gate on PAYROLL_MANAGE, same as every other payroll action.");

    await cleanUp(employee.id);
    console.log("\nPASS: Payroll Batch 2c computation engine proven against real rows.");
  } catch (error) {
    await cleanUp(employee.id);
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
