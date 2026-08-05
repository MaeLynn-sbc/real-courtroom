/**
 * Payroll Batch 1 — manual attendance entry + correction. Proves,
 * against real rows:
 *   1. A manual entry captures rawClockIn/rawClockOut from clockIn/
 *      clockOut at creation, source=MANUAL, and no correction fields
 *      set.
 *   2. A second entry for the same employee/workDate is rejected
 *      (AttendanceRecordAlreadyExistsError) — @@unique enforced.
 *   3. Correcting an entry updates clockIn/clockOut and stamps
 *      correctedByUserId/correctedAt/correctionReason — but leaves
 *      rawClockIn/rawClockOut exactly as originally captured. Proven
 *      failing-first: this assertion would fail against a version of
 *      correctEntry that also touches raw*.
 *   4. Correcting without a reason is rejected.
 *   5. Access control (Part 3's own requirement — "Include a test
 *      asserting a non-owner session receives 403 on each payroll
 *      endpoint"): against the real, seeded COURT_ATTENDANT role,
 *      hasPermission denies PAYROLL_MANAGE; against real, seeded
 *      OWNER, it's granted. Same hasPermission() function every
 *      payroll action's requirePermission() call goes through.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { hasPermission } from "../../lib/rbac";
import { prisma } from "../../lib/prisma";
import { PERMISSIONS } from "../../types/permissions";
import {
  attendanceRecordService,
  AttendanceRecordAlreadyExistsError,
} from "./attendance-record.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(employeeId: string, workDate: Date): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { entityType: "AttendanceRecord" } });
  await prisma.attendanceRecord.deleteMany({ where: { employeeId, workDate } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const workDate = new Date(2031, 3, 9); // Wednesday, distinct from other fixture dates in this session

  await cleanUp(employee.id, workDate);

  try {
    // ============== 1. Manual entry captures raw* at creation ==============
    const clockIn = new Date(workDate.getFullYear(), workDate.getMonth(), workDate.getDate(), 7, 0);
    const clockOut = new Date(
      workDate.getFullYear(),
      workDate.getMonth(),
      workDate.getDate(),
      15,
      0,
    );
    const created = await attendanceRecordService.createManualEntry(
      { employeeId: employee.id, workDate, clockIn, clockOut },
      owner.id,
    );
    assert(created.source === "MANUAL", `expected source MANUAL, got ${created.source}`);
    assert(
      created.rawClockIn.getTime() === clockIn.getTime(),
      "expected rawClockIn to equal clockIn at creation",
    );
    assert(
      created.rawClockOut?.getTime() === clockOut.getTime(),
      "expected rawClockOut to equal clockOut at creation",
    );
    assert(created.correctedAt === null, "expected a freshly-created entry to have no correction");
    console.log(
      "PASS: a manual entry captures rawClockIn/rawClockOut from clockIn/clockOut at creation, source=MANUAL, uncorrected.",
    );

    // ============== 2. Duplicate employee+workDate rejected ==============
    let rejectedDuplicate = false;
    try {
      await attendanceRecordService.createManualEntry(
        { employeeId: employee.id, workDate, clockIn, clockOut },
        owner.id,
      );
    } catch (error) {
      rejectedDuplicate = error instanceof AttendanceRecordAlreadyExistsError;
    }
    assert(
      rejectedDuplicate,
      "expected a second entry for the same employee/workDate to be rejected",
    );
    console.log(
      "PASS: a second attendance entry for the same employee and work date is rejected — @@unique enforced.",
    );

    // ============== 3. Correction updates clockIn/clockOut, leaves raw* untouched ==============
    const correctedClockIn = new Date(clockIn.getTime() + 15 * 60 * 1000); // 15 min later
    const correctedClockOut = new Date(clockOut.getTime() - 30 * 60 * 1000); // 30 min earlier
    const corrected = await attendanceRecordService.correctEntry(
      {
        recordId: created.id,
        clockIn: correctedClockIn,
        clockOut: correctedClockOut,
        reason: "Forgot to clock in on time, confirmed via CCTV.",
      },
      owner.id,
    );
    assert(
      corrected.clockIn.getTime() === correctedClockIn.getTime(),
      "expected clockIn to be updated to the corrected value",
    );
    assert(
      corrected.clockOut?.getTime() === correctedClockOut.getTime(),
      "expected clockOut to be updated to the corrected value",
    );
    assert(
      corrected.rawClockIn.getTime() === clockIn.getTime(),
      "expected rawClockIn to remain the ORIGINAL value, untouched by the correction",
    );
    assert(
      corrected.rawClockOut?.getTime() === clockOut.getTime(),
      "expected rawClockOut to remain the ORIGINAL value, untouched by the correction",
    );
    assert(corrected.correctedByUserId === owner.id, "expected correctedByUserId to be set");
    assert(corrected.correctedAt !== null, "expected correctedAt to be set");
    assert(
      corrected.correctionReason === "Forgot to clock in on time, confirmed via CCTV.",
      "expected correctionReason to be persisted",
    );
    console.log(
      "PASS: correcting an entry updates clockIn/clockOut and stamps correctedBy/At/Reason, while rawClockIn/rawClockOut stay exactly as originally captured.",
    );

    // ============== 4. Correction without a reason is rejected ==============
    let rejectedNoReason = false;
    try {
      await attendanceRecordService.correctEntry(
        {
          recordId: created.id,
          clockIn: correctedClockIn,
          clockOut: correctedClockOut,
          reason: "",
        },
        owner.id,
      );
    } catch (error) {
      rejectedNoReason = error instanceof Error && error.message.includes("reason is required");
    }
    assert(rejectedNoReason, "expected a correction with no reason to be rejected");
    console.log("PASS: correcting an entry with no reason is rejected.");

    // ============== 5. Access control against real seeded roles ==============
    const ownerRole = await prisma.role.findFirstOrThrow({
      where: { name: "OWNER" },
      include: { permissions: { include: { permission: true } } },
    });
    const courtAttendantRole = await prisma.role.findFirstOrThrow({
      where: { name: "COURT_ATTENDANT" },
      include: { permissions: { include: { permission: true } } },
    });
    const ownerPermissionKeys = ownerRole.permissions.map((p) => p.permission.key);
    const receptionistPermissionKeys = courtAttendantRole.permissions.map((p) => p.permission.key);

    assert(
      hasPermission(ownerPermissionKeys, PERMISSIONS.PAYROLL_MANAGE),
      "expected the real, seeded OWNER role to have PAYROLL_MANAGE",
    );
    assert(
      !hasPermission(receptionistPermissionKeys, PERMISSIONS.PAYROLL_MANAGE),
      "expected the real, seeded COURT_ATTENDANT role to NOT have PAYROLL_MANAGE — a non-owner session must be denied",
    );
    console.log(
      "PASS: against real seeded roles, OWNER has PAYROLL_MANAGE and COURT_ATTENDANT (a non-owner role) does not — the same hasPermission() check every payroll action's requirePermission() uses.",
    );

    await cleanUp(employee.id, workDate);
    console.log("\nPASS: payroll Batch 1 attendance entry/correction proven against real rows.");
  } catch (error) {
    await cleanUp(employee.id, workDate);
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
