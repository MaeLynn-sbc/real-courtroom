/**
 * Payroll Batch 1 closeout (owner-approved 2026-08-18). Three linked
 * changes, proven together against real rows:
 *
 *   - @@unique([employeeId, workDate]) DROPPED. It blocked an employee
 *     working two shifts in one day, which happens here. Replaced by an
 *     OVERLAP guard: two records on the same day are fine, two records
 *     covering the same minutes are not.
 *   - workDate DERIVED from clockIn via computeBusinessDate, not taken
 *     from whatever calendar date the form happened to show. A shift
 *     running 23:00-01:00 belongs to the night it STARTED.
 *   - clockOut > clockIn enforced at the SERVICE (and by a DB CHECK in
 *     migration 76), not only in the Zod schema the actions happen to
 *     call. A direct service call could previously persist a negative
 *     shift.
 *
 * Written failing-first. Before the change: the overnight cases filed
 * under the wrong date, the second same-day shift was rejected outright
 * by the unique constraint, and the negative-shift call was accepted.
 *
 * The rollover cases are only meaningful because jest and the app both
 * pin Asia/Manila (jest.config.ts, lib/env.ts, Dockerfile) — before that
 * pin they'd have passed or failed by accident depending on the machine.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { computeBusinessDate } from "../../lib/business-date";
import { prisma } from "../../lib/prisma";
import { settingsService } from "../settings/settings.service";
import {
  attendanceRecordService,
  AttendanceRecordOverlapError,
} from "./attendance-record.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

// Far-future, distinct from every other fixture date this session.
const NIGHT = new Date(2031, 4, 12); // Mon 12 May 2031

function at(dayOffset: number, hour: number, minute = 0): Date {
  return new Date(NIGHT.getFullYear(), NIGHT.getMonth(), NIGHT.getDate() + dayOffset, hour, minute);
}

async function cleanUp(employeeId: string): Promise<void> {
  await prisma.attendanceRecord.deleteMany({
    where: { employeeId, workDate: { gte: at(-2, 0), lte: at(3, 0) } },
  });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const { businessDateRolloverHour } = await settingsService.getCourtHours();

  await cleanUp(employee.id);

  try {
    // ============== 1. 23:00-01:00 files under the night it STARTED ==============
    // Entered from one calendar date with the form's auto-roll, so
    // clockOut lands on the following day. The record must file under
    // 12 May (when the shift began), not 13 May.
    const overnight = await attendanceRecordService.createManualEntry(
      { employeeId: employee.id, clockIn: at(0, 23, 0), clockOut: at(1, 1, 0) },
      owner.id,
    );
    assert(
      overnight.workDate.getTime() === at(0, 0).getTime(),
      `expected an overnight shift to file under the night it started (${at(0, 0).toDateString()}), got ${overnight.workDate.toDateString()}`,
    );
    console.log("PASS: a 23:00-01:00 shift files under the earlier business date, not the calendar date it ended on.");

    // ============== 2. Correct side of the 3am rollover ==============
    // Rollover hour is 3 (production has no cms.courtHours row, so the
    // code default applies). A shift clocking in at 01:00 is BEFORE the
    // rollover, so it still belongs to the previous business day.
    const beforeRollover = await attendanceRecordService.createManualEntry(
      { employeeId: employee.id, clockIn: at(2, 1, 0), clockOut: at(2, 2, 30) },
      owner.id,
    );
    const expectedBefore = computeBusinessDate(at(2, 1, 0), businessDateRolloverHour);
    assert(
      beforeRollover.workDate.getTime() === expectedBefore.getTime(),
      `expected a 01:00 clock-in to file under ${expectedBefore.toDateString()} (before the ${businessDateRolloverHour}am rollover), got ${beforeRollover.workDate.toDateString()}`,
    );
    assert(
      beforeRollover.workDate.getTime() === at(1, 0).getTime(),
      "expected a 01:00 clock-in on 14 May to file under 13 May",
    );

    // And one clocking in AFTER the rollover files on the current day.
    const afterRollover = await attendanceRecordService.createManualEntry(
      { employeeId: employee.id, clockIn: at(2, 4, 0), clockOut: at(2, 5, 0) },
      owner.id,
    );
    assert(
      afterRollover.workDate.getTime() === at(2, 0).getTime(),
      `expected a 04:00 clock-in to file under its own day, got ${afterRollover.workDate.toDateString()}`,
    );
    console.log("PASS: shifts either side of the 3am rollover file on the correct side of it.");

    // ============== 3. Two non-overlapping shifts in ONE workDate ==============
    // The whole reason the unique constraint had to go. Both are on
    // 15 May, back-to-back with a gap, and both must save.
    const firstShift = await attendanceRecordService.createManualEntry(
      { employeeId: employee.id, clockIn: at(3, 7, 0), clockOut: at(3, 11, 0) },
      owner.id,
    );
    const secondShift = await attendanceRecordService.createManualEntry(
      { employeeId: employee.id, clockIn: at(3, 14, 0), clockOut: at(3, 18, 0) },
      owner.id,
    );
    assert(
      firstShift.workDate.getTime() === secondShift.workDate.getTime(),
      "fixture check: both shifts should land on the same workDate",
    );
    assert(firstShift.id !== secondShift.id, "expected two distinct records");
    const sameDayCount = await prisma.attendanceRecord.count({
      where: { employeeId: employee.id, workDate: at(3, 0) },
    });
    assert(sameDayCount === 2, `expected 2 records on one workDate, got ${sameDayCount}`);
    console.log("PASS: two non-overlapping shifts in one day both save — the unique constraint is genuinely gone.");

    // ============== 4. Overlapping shifts rejected at the service ==============
    let overlapRejected = false;
    try {
      await attendanceRecordService.createManualEntry(
        // 10:00-12:00 straddles the 07:00-11:00 shift already recorded.
        { employeeId: employee.id, clockIn: at(3, 10, 0), clockOut: at(3, 12, 0) },
        owner.id,
      );
    } catch (error) {
      overlapRejected = true;
      assert(
        error instanceof AttendanceRecordOverlapError,
        `expected AttendanceRecordOverlapError, got ${error}`,
      );
    }
    assert(overlapRejected, "expected an overlapping shift to be rejected");

    // Exactly abutting is NOT an overlap — clocking in the same minute
    // another shift ended is legitimate.
    const abutting = await attendanceRecordService.createManualEntry(
      { employeeId: employee.id, clockIn: at(3, 18, 0), clockOut: at(3, 20, 0) },
      owner.id,
    );
    assert(abutting.id, "expected a shift starting exactly when another ended to be allowed");
    console.log("PASS: overlapping shifts rejected; exactly-abutting shifts allowed.");

    // ============== 5. clockOut <= clockIn rejected AT THE SERVICE ==============
    // Previously only the Zod schema caught this, so any caller that
    // skipped the action layer could persist a negative shift.
    for (const [label, clockOut] of [
      ["before clock-in", at(0, 6, 0)],
      ["equal to clock-in", at(0, 7, 0)],
    ] as const) {
      let rejected = false;
      try {
        await attendanceRecordService.createManualEntry(
          { employeeId: employee.id, clockIn: at(0, 7, 0), clockOut },
          owner.id,
        );
      } catch (error) {
        rejected = true;
        assert(
          String(error).toLowerCase().includes("after"),
          `expected a clock-out-after-clock-in error for ${label}, got ${error}`,
        );
      }
      assert(rejected, `expected a clock-out ${label} to be rejected by the service`);
    }
    console.log("PASS: a direct service call with clockOut <= clockIn is rejected, not just by the schema.");

    console.log("\nPASS: overnight filing, rollover sides, same-day shifts and overlap guard proven against real rows.");
  } finally {
    await cleanUp(employee.id);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
