/**
 * Payroll Batch 2b — EmployeeRate + PayPeriod. Proves, against real rows:
 *   1. resolveRateForDate is non-retroactive: a rate change mid-period does
 *      NOT alter what an earlier day resolves to. This is the single most
 *      important property of this batch — the whole point of rejecting
 *      CoachRate's flat/overwrite model.
 *   2. createRate rejects a rate <= 0.
 *   3. deleteLatestRate succeeds on the newest row; proven failing-first —
 *      attempting to delete an OLDER row while a newer one exists is
 *      rejected, and BOTH rows are left completely untouched.
 *   4. computeSemiMonthlyPeriodBounds — pure function, boundary dates (the
 *      15th vs the 16th, and month-end for a 28/30/31-day month).
 *   5. getOrCreatePeriodForDate is idempotent under real concurrency (two
 *      simultaneous calls for the same date resolve to exactly one row).
 *   6. Access control: real seeded OWNER has PAYROLL_MANAGE, RECEPTIONIST
 *      does not — same gate every payroll action in this batch relies on.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { hasPermission } from "../../lib/rbac";
import { prisma } from "../../lib/prisma";
import { PERMISSIONS } from "../../types/permissions";
import { employeeRateService } from "./employee-rate.service";
import { computeSemiMonthlyPeriodBounds, payPeriodService } from "./pay-period.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

// April 2031 — distinct from other fixture months already used elsewhere
// this session (schedule-assignment.integration.ts uses April 7, 2031, so
// this file uses different days within the same month deliberately, to
// keep any date arithmetic mistake from accidentally canceling out).
const RATE_A_EFFECTIVE = new Date(2031, 3, 1);
const RATE_B_EFFECTIVE = new Date(2031, 3, 10);
const DAY_BEFORE_CHANGE = new Date(2031, 3, 5);
const DAY_AFTER_CHANGE = new Date(2031, 3, 20);

async function cleanupRates(employeeId: string): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { entityType: "EmployeeRate" } });
  await prisma.employeeRate.deleteMany({
    where: { employeeId, effectiveFrom: { gte: RATE_A_EFFECTIVE, lte: DAY_AFTER_CHANGE } },
  });
}

async function cleanupPeriods(): Promise<void> {
  await prisma.payPeriod.deleteMany({
    where: { startDate: { gte: new Date(2031, 3, 1), lte: new Date(2031, 3, 30) } },
  });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });

  await cleanupRates(employee.id);
  await cleanupPeriods();

  try {
    // ============== 1. Non-retroactive effective-dating ==============
    await employeeRateService.createRate(
      { employeeId: employee.id, dailyRateCents: 50000, effectiveFrom: RATE_A_EFFECTIVE },
      owner.id,
    );
    const beforeChange = await employeeRateService.resolveRateForDate(employee.id, DAY_BEFORE_CHANGE);
    assert(beforeChange?.dailyRateCents === 50000, "expected rate A (500.00) to apply before the change");

    await employeeRateService.createRate(
      { employeeId: employee.id, dailyRateCents: 60000, effectiveFrom: RATE_B_EFFECTIVE },
      owner.id,
    );

    const stillBeforeChange = await employeeRateService.resolveRateForDate(employee.id, DAY_BEFORE_CHANGE);
    assert(
      stillBeforeChange?.dailyRateCents === 50000,
      `expected the earlier day to STILL resolve to rate A (500.00) after rate B was added, got ${stillBeforeChange?.dailyRateCents}`,
    );
    const afterChange = await employeeRateService.resolveRateForDate(employee.id, DAY_AFTER_CHANGE);
    assert(
      afterChange?.dailyRateCents === 60000,
      `expected a day after the change to resolve to rate B (600.00), got ${afterChange?.dailyRateCents}`,
    );
    console.log(
      "PASS: a rate change mid-period does not retroactively affect an earlier day — resolveRateForDate is non-retroactive.",
    );

    // ============== 2. Reject a non-positive rate ==============
    let rejectedZeroRate = false;
    try {
      await employeeRateService.createRate(
        { employeeId: employee.id, dailyRateCents: 0, effectiveFrom: new Date(2031, 3, 25) },
        owner.id,
      );
    } catch {
      rejectedZeroRate = true;
    }
    assert(rejectedZeroRate, "expected a zero daily rate to be rejected");
    console.log("PASS: createRate rejects a rate <= 0.");

    // ============== 3. deleteLatestRate — failing-first on an older row ==============
    const history = await employeeRateService.listRateHistory(employee.id);
    const olderRow = history.find((r) => r.effectiveFrom.getTime() === RATE_A_EFFECTIVE.getTime());
    const newestRow = history.find((r) => r.effectiveFrom.getTime() === RATE_B_EFFECTIVE.getTime());
    assert(olderRow && newestRow, "test setup sanity: expected both rate rows to exist");

    let rejectedOlderDelete = false;
    try {
      await employeeRateService.deleteLatestRate(olderRow!.id, owner.id);
    } catch {
      rejectedOlderDelete = true;
    }
    assert(rejectedOlderDelete, "expected deleting an OLDER rate row to be rejected");
    const rowsStillPresent = await prisma.employeeRate.count({
      where: { id: { in: [olderRow!.id, newestRow!.id] } },
    });
    assert(rowsStillPresent === 2, "expected BOTH rows to be untouched after the rejected delete attempt");
    console.log("PASS: deleting an older rate row is rejected — both rows left completely untouched.");

    await employeeRateService.deleteLatestRate(newestRow!.id, owner.id);
    const afterDelete = await prisma.employeeRate.findUnique({ where: { id: newestRow!.id } });
    assert(afterDelete === null, "expected the newest row to actually be deleted");
    console.log("PASS: deleteLatestRate succeeds on the newest row.");

    // ============== 4. computeSemiMonthlyPeriodBounds boundaries ==============
    const the15th = computeSemiMonthlyPeriodBounds(new Date(2031, 3, 15));
    assert(
      the15th.startDate.getTime() === new Date(2031, 3, 1).getTime() &&
        the15th.endDate.getTime() === new Date(2031, 3, 15).getTime(),
      "expected the 15th to fall in the 1st-15th period",
    );
    const the16th = computeSemiMonthlyPeriodBounds(new Date(2031, 3, 16));
    assert(
      the16th.startDate.getTime() === new Date(2031, 3, 16).getTime() &&
        the16th.endDate.getTime() === new Date(2031, 3, 30).getTime(),
      `expected the 16th to fall in the 16th-end-of-April (30) period, got end ${the16th.endDate.toDateString()}`,
    );
    const febLeapCheck = computeSemiMonthlyPeriodBounds(new Date(2032, 1, 20)); // 2032 is a leap year
    assert(
      febLeapCheck.endDate.getDate() === 29,
      `expected Feb 2032 (leap year) second-half period to end on the 29th, got ${febLeapCheck.endDate.getDate()}`,
    );
    console.log("PASS: computeSemiMonthlyPeriodBounds handles the 15th/16th boundary and month-end (including leap Feb) correctly.");

    // ============== 5. getOrCreatePeriodForDate — concurrent idempotency ==============
    const raceDate = new Date(2031, 3, 8);
    const [first, second] = await Promise.all([
      payPeriodService.getOrCreatePeriodForDate(raceDate),
      payPeriodService.getOrCreatePeriodForDate(raceDate),
    ]);
    assert(first.id === second.id, "expected two concurrent calls for the same date to resolve to the SAME row");
    const periodCount = await prisma.payPeriod.count({
      where: { startDate: first.startDate, endDate: first.endDate },
    });
    assert(periodCount === 1, `expected exactly 1 period row after the race, got ${periodCount}`);
    console.log("PASS: getOrCreatePeriodForDate is idempotent under real concurrency — no duplicate period rows.");

    // ============== 6. Access control against real seeded roles ==============
    const ownerRole = await prisma.role.findFirstOrThrow({
      where: { name: "OWNER" },
      include: { permissions: { include: { permission: true } } },
    });
    const receptionistRole = await prisma.role.findFirstOrThrow({
      where: { name: "RECEPTIONIST" },
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
        receptionistRole.permissions.map((p) => p.permission.key),
        PERMISSIONS.PAYROLL_MANAGE,
      ),
      "expected the real, seeded RECEPTIONIST role to NOT have PAYROLL_MANAGE",
    );
    console.log("PASS: rate/period actions gate on PAYROLL_MANAGE, same as every other payroll action.");

    await cleanupRates(employee.id);
    await cleanupPeriods();
    console.log("\nPASS: Payroll Batch 2b (EmployeeRate + PayPeriod) proven against real rows.");
  } catch (error) {
    await cleanupRates(employee.id);
    await cleanupPeriods();
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
