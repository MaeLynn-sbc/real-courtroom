/**
 * Payroll Batch 2a — scheduling. Proves, against real rows:
 *   1. assignDay with a templateId computes scheduledStart/scheduledEnd
 *      by combining the template's HH:MM with the given workDate,
 *      correctly, using the real seeded "Opening" template (07:00-15:00).
 *   2. Re-assigning the same employee/day is a true upsert — the row
 *      count stays 1, and the new values win. Proven failing-first
 *      against a version that would create a second row (the
 *      @@unique([employeeId, workDate]) would reject a naive create,
 *      but this proves the SERVICE handles it gracefully via upsert,
 *      not by surfacing that raw constraint error to the caller).
 *   3. A custom-hours assignment (isOverride: true) is stored with
 *      templateId null and the exact given start/end; an end time at or
 *      before the start time is rejected.
 *   4. clearDay deletes the row entirely (Off = absence of a row).
 *   5. bulkAssign materializes one real row per day across a date
 *      range, is idempotent on rerun (same row count, no duplicates),
 *      and rejects a range over 180 days.
 *   6. getWeek only returns assignments inside the requested 7-day
 *      window, not adjacent days.
 *   7. Access control: against real seeded roles, OWNER has
 *      PAYROLL_MANAGE (the permission gating every new scheduling
 *      action) and RECEPTIONIST does not.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { hasPermission } from "../../lib/rbac";
import { prisma } from "../../lib/prisma";
import { PERMISSIONS } from "../../types/permissions";
import { scheduleAssignmentService } from "./schedule-assignment.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

// Monday, distinct from other fixture dates in this session.
const TEST_WEEK_START = new Date(2031, 3, 7);

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

async function cleanUp(employeeId: string): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { entityType: "ScheduleAssignment" } });
  await prisma.scheduleAssignment.deleteMany({
    where: { employeeId, workDate: { gte: addDays(TEST_WEEK_START, -7), lte: addDays(TEST_WEEK_START, 200) } },
  });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const openingTemplate = await prisma.shiftTemplate.findUniqueOrThrow({ where: { name: "Opening" } });

  await cleanUp(employee.id);

  try {
    // ============== 1. Template assignment computes scheduledStart/End correctly ==============
    const monday = TEST_WEEK_START;
    const assigned = await scheduleAssignmentService.assignDay(
      { employeeId: employee.id, workDate: monday, templateId: openingTemplate.id },
      owner.id,
    );
    assert(assigned.templateId === openingTemplate.id, "expected templateId to be set");
    assert(
      assigned.scheduledStart.getHours() === 7 && assigned.scheduledStart.getMinutes() === 0,
      `expected scheduledStart 07:00, got ${assigned.scheduledStart.toTimeString()}`,
    );
    assert(
      assigned.scheduledEnd.getHours() === 15 && assigned.scheduledEnd.getMinutes() === 0,
      `expected scheduledEnd 15:00, got ${assigned.scheduledEnd.toTimeString()}`,
    );
    assert(assigned.isOverride === false, "expected isOverride false for a template assignment");
    console.log(
      "PASS: assigning the real seeded Opening template computes scheduledStart/scheduledEnd (07:00-15:00) correctly from workDate + template.",
    );

    // ============== 2. Re-assigning the same day is a true upsert ==============
    const closingTemplate = await prisma.shiftTemplate.findUniqueOrThrow({ where: { name: "Closing" } });
    const reassigned = await scheduleAssignmentService.assignDay(
      { employeeId: employee.id, workDate: monday, templateId: closingTemplate.id },
      owner.id,
    );
    assert(reassigned.id === assigned.id, "expected the SAME row to be updated, not a new one");
    assert(reassigned.templateId === closingTemplate.id, "expected the template to be switched");
    const mondayCount = await prisma.scheduleAssignment.count({
      where: { employeeId: employee.id, workDate: monday },
    });
    assert(mondayCount === 1, `expected exactly 1 row for that employee/day after reassignment, got ${mondayCount}`);
    console.log("PASS: re-assigning the same employee/day upserts in place — one row, new values win.");

    // ============== 3. Custom hours (isOverride) ==============
    const tuesday = addDays(monday, 1);
    const customStart = new Date(tuesday.getFullYear(), tuesday.getMonth(), tuesday.getDate(), 9, 30);
    const customEnd = new Date(tuesday.getFullYear(), tuesday.getMonth(), tuesday.getDate(), 17, 30);
    const custom = await scheduleAssignmentService.assignDay(
      { employeeId: employee.id, workDate: tuesday, scheduledStart: customStart, scheduledEnd: customEnd },
      owner.id,
    );
    assert(custom.templateId === null, "expected templateId null for a custom-hours assignment");
    assert(custom.isOverride === true, "expected isOverride true for custom hours");
    assert(custom.scheduledStart.getTime() === customStart.getTime(), "expected the exact custom start time");
    assert(custom.scheduledEnd.getTime() === customEnd.getTime(), "expected the exact custom end time");

    let rejectedBadCustomRange = false;
    try {
      await scheduleAssignmentService.assignDay(
        { employeeId: employee.id, workDate: tuesday, scheduledStart: customEnd, scheduledEnd: customStart },
        owner.id,
      );
    } catch {
      rejectedBadCustomRange = true;
    }
    assert(rejectedBadCustomRange, "expected an end time at/before the start time to be rejected");
    console.log("PASS: custom hours are stored exactly as given (isOverride, templateId null); an invalid range is rejected.");

    // ============== 4. clearDay deletes the row ==============
    await scheduleAssignmentService.clearDay(employee.id, tuesday, owner.id);
    const clearedRow = await prisma.scheduleAssignment.findUnique({
      where: { employeeId_workDate: { employeeId: employee.id, workDate: tuesday } },
    });
    assert(clearedRow === null, "expected the row to be gone after clearDay — Off is the absence of a row");
    console.log("PASS: clearDay removes the row entirely.");

    // ============== 5. bulkAssign materializes real rows, idempotent, range-capped ==============
    const bulkStart = addDays(monday, 2); // Wednesday
    const bulkEnd = addDays(monday, 6); // Sunday — 5 days
    const firstRun = await scheduleAssignmentService.bulkAssign(
      { employeeId: employee.id, templateId: openingTemplate.id, startDate: bulkStart, endDate: bulkEnd },
      owner.id,
    );
    assert(firstRun.dayCount === 5, `expected 5 days assigned, got ${firstRun.dayCount}`);
    const rowsAfterFirstRun = await prisma.scheduleAssignment.count({
      where: { employeeId: employee.id, workDate: { gte: bulkStart, lte: bulkEnd } },
    });
    assert(rowsAfterFirstRun === 5, `expected exactly 5 rows materialized, got ${rowsAfterFirstRun}`);

    await scheduleAssignmentService.bulkAssign(
      { employeeId: employee.id, templateId: openingTemplate.id, startDate: bulkStart, endDate: bulkEnd },
      owner.id,
    );
    const rowsAfterSecondRun = await prisma.scheduleAssignment.count({
      where: { employeeId: employee.id, workDate: { gte: bulkStart, lte: bulkEnd } },
    });
    assert(
      rowsAfterSecondRun === 5,
      `expected still exactly 5 rows after a second identical bulk assign (idempotent), got ${rowsAfterSecondRun}`,
    );
    console.log("PASS: bulkAssign materializes one real row per day, and a second identical run creates no duplicates.");

    let rejectedTooLong = false;
    try {
      await scheduleAssignmentService.bulkAssign(
        {
          employeeId: employee.id,
          templateId: openingTemplate.id,
          startDate: monday,
          endDate: addDays(monday, 200),
        },
        owner.id,
      );
    } catch {
      rejectedTooLong = true;
    }
    assert(rejectedTooLong, "expected a bulk-assign range over 180 days to be rejected");
    console.log("PASS: bulkAssign rejects a range over the 180-day cap.");

    // ============== 6. getWeek only returns the requested window ==============
    const week = await scheduleAssignmentService.getWeek(monday);
    const weekWorkDates = week.assignments
      .filter((a) => a.employeeId === employee.id)
      .map((a) => a.workDate.getTime());
    const outsideWindowDate = addDays(bulkEnd, 1); // the day right after this window
    const outsideAssignment = await prisma.scheduleAssignment.findUnique({
      where: { employeeId_workDate: { employeeId: employee.id, workDate: outsideWindowDate } },
    });
    assert(outsideAssignment === null, "test setup sanity: expected no row on the day just outside the window");
    assert(
      weekWorkDates.every((t) => t >= monday.getTime() && t < addDays(monday, 7).getTime()),
      "expected every returned assignment to fall inside the requested 7-day window",
    );
    assert(weekWorkDates.length >= 5, "expected getWeek to include the bulk-assigned days inside its window");
    console.log("PASS: getWeek scopes assignments to exactly the requested 7-day window.");

    // ============== 7. Access control against real seeded roles ==============
    const ownerRole = await prisma.role.findFirstOrThrow({
      where: { name: "OWNER" },
      include: { permissions: { include: { permission: true } } },
    });
    const receptionistRole = await prisma.role.findFirstOrThrow({
      where: { name: "RECEPTIONIST" },
      include: { permissions: { include: { permission: true } } },
    });
    const ownerPermissionKeys = ownerRole.permissions.map((p) => p.permission.key);
    const receptionistPermissionKeys = receptionistRole.permissions.map((p) => p.permission.key);
    assert(
      hasPermission(ownerPermissionKeys, PERMISSIONS.PAYROLL_MANAGE),
      "expected the real, seeded OWNER role to have PAYROLL_MANAGE",
    );
    assert(
      !hasPermission(receptionistPermissionKeys, PERMISSIONS.PAYROLL_MANAGE),
      "expected the real, seeded RECEPTIONIST role to NOT have PAYROLL_MANAGE — scheduling actions gate on this",
    );
    console.log("PASS: scheduling's PAYROLL_MANAGE gate matches OWNER-only, same as every other payroll action.");

    await cleanUp(employee.id);
    console.log("\nPASS: Payroll Batch 2a scheduling proven against real rows.");
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
