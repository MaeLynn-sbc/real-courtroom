/**
 * Owner incident (2026-08-26): payroll read PHP 0.00 and NO_ATTENDANCE for
 * every day from Aug 15 onward. Staff HAD been there — 22 closed Shift
 * rows carried their real times — but AttendanceRecord had not been
 * written since a one-off backfill on Aug 14. Manual entry was a daily
 * chore nobody was reminded of, and its absence was invisible until
 * payroll ran weeks later.
 *
 * Closing a shift now seeds the attendance record, so the gap cannot
 * reopen. Proves, against real rows:
 *   1. Closing a shift creates an AttendanceRecord: source LIVE, shiftId
 *      set, clock times taken from the shift, raw* captured.
 *   2. workDate is derived through the rollover hour, so a closing shift
 *      running past midnight files under the night it started.
 *   3. Idempotent on shiftId — seeding twice creates one record.
 *   4. An existing MANUAL record covering those hours wins; the shift
 *      does not duplicate it.
 *   5. Seeding NEVER blocks the close — a shift whose attendance cannot
 *      be written still closes, with its cash figures intact.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { computeBusinessDate } from "../../lib/business-date";
import { prisma } from "../../lib/prisma";
import { attendanceRecordService } from "./attendance-record.service";
import { settingsService } from "../settings/settings.service";
import { shiftService } from "../shift/shift.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const NIGHT = new Date(2032, 8, 14); // far-future, isolated

function at(dayOffset: number, hour: number, minute = 0): Date {
  return new Date(NIGHT.getFullYear(), NIGHT.getMonth(), NIGHT.getDate() + dayOffset, hour, minute);
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const { businessDateRolloverHour } = await settingsService.getCourtHours();
  const shiftIds: string[] = [];

  async function cleanUp() {
    await prisma.attendanceRecord.deleteMany({
      where: { employeeId: employee.id, workDate: { gte: at(-2, 0), lte: at(3, 0) } },
    });
    await prisma.attendanceRecord.deleteMany({ where: { shiftId: { in: shiftIds } } });
    await prisma.shift.deleteMany({ where: { id: { in: shiftIds } } });
  }

  async function makeClosedShift(startedAt: Date, endedAt: Date) {
    const shift = await prisma.shift.create({
      data: {
        shiftNumber: `SHIFT-SEED-${Date.now()}-${shiftIds.length}`,
        employeeId: employee.id,
        status: "CLOSED",
        startedAt,
        endedAt,
        openingCashCents: 0,
      },
    });
    shiftIds.push(shift.id);
    return shift;
  }

  await cleanUp();

  try {
    // ============== 1. Seeding produces a LIVE record from the shift ==============
    const shift = await makeClosedShift(at(0, 7, 40), at(0, 15, 19));
    const seeded = await attendanceRecordService.seedFromShift(shift, owner.id);
    assert(seeded, "expected a record to be seeded from a closed shift");
    assert(seeded!.source === "LIVE", `expected source LIVE, got ${seeded!.source}`);
    assert(seeded!.shiftId === shift.id, "expected shiftId to link back to the shift");
    assert(
      seeded!.clockIn.getTime() === shift.startedAt.getTime() &&
        seeded!.clockOut?.getTime() === shift.endedAt!.getTime(),
      "expected the clock times to come from the shift",
    );
    assert(
      seeded!.rawClockIn.getTime() === shift.startedAt.getTime() &&
        seeded!.rawClockOut?.getTime() === shift.endedAt!.getTime(),
      "expected raw* to capture what the shift originally said",
    );
    console.log("PASS: closing a shift seeds a LIVE attendance record with the shift's own times.");

    // ============== 2. workDate goes through the rollover hour ==============
    // A closing shift 15:10 -> 00:40 belongs to the night it STARTED.
    const overnight = await makeClosedShift(at(1, 15, 10), at(2, 0, 40));
    const seededOvernight = await attendanceRecordService.seedFromShift(overnight, owner.id);
    assert(seededOvernight, "expected the overnight shift to seed");
    const expected = computeBusinessDate(overnight.startedAt, businessDateRolloverHour);
    assert(
      seededOvernight!.workDate.getTime() === expected.getTime(),
      `expected workDate ${expected.toDateString()}, got ${seededOvernight!.workDate.toDateString()}`,
    );
    assert(
      seededOvernight!.workDate.getTime() === at(1, 0).getTime(),
      "expected a shift ending after midnight to file under the night it started",
    );
    console.log("PASS: workDate is derived through the rollover hour — an overnight close files under the right night.");

    // ============== 3. Idempotent on shiftId ==============
    const again = await attendanceRecordService.seedFromShift(shift, owner.id);
    assert(again === null, "expected a second seed of the same shift to do nothing");
    const count = await prisma.attendanceRecord.count({ where: { shiftId: shift.id } });
    assert(count === 1, `expected exactly 1 record for the shift, got ${count}`);
    console.log("PASS: seeding is idempotent on shiftId — a re-run creates nothing.");

    // ============== 4. An existing MANUAL record wins ==============
    const manualDay = at(3, 8, 0);
    await attendanceRecordService.createManualEntry(
      { employeeId: employee.id, clockIn: manualDay, clockOut: at(3, 16, 0) },
      owner.id,
    );
    const overlappingShift = await makeClosedShift(at(3, 8, 30), at(3, 15, 30));
    const notSeeded = await attendanceRecordService.seedFromShift(overlappingShift, owner.id);
    assert(notSeeded === null, "expected an overlapping manual record to block seeding");
    const dayCount = await prisma.attendanceRecord.count({
      where: { employeeId: employee.id, workDate: at(3, 0) },
    });
    assert(dayCount === 1, `expected the manual record to stand alone, got ${dayCount} records`);
    console.log("PASS: an existing manual record wins — the shift does not duplicate it.");

    // ============== 5. Seeding never blocks the close ==============
    // A live shift whose hours are already covered by a manual record:
    // endShift must still close it, cash figures intact.
    const blockedDay = at(-1, 9, 0);
    await attendanceRecordService.createManualEntry(
      { employeeId: employee.id, clockIn: blockedDay, clockOut: at(-1, 17, 0) },
      owner.id,
    );
    const liveShift = await prisma.shift.create({
      data: {
        shiftNumber: `SHIFT-SEED-LIVE-${Date.now()}`,
        employeeId: employee.id,
        status: "OPEN",
        startedAt: at(-1, 9, 30),
        openingCashCents: 0,
      },
    });
    shiftIds.push(liveShift.id);

    const closed = await shiftService.endShift(
      liveShift.id,
      { closingCashBreakdown: {}, closingNotes: "seed-test" },
      owner.id,
    );
    assert(closed.status === "CLOSED", "expected the shift to close even though attendance could not be seeded");
    assert(closed.closingCashCents === 0, "expected the cash figures to be intact");
    const seededForLive = await prisma.attendanceRecord.count({ where: { shiftId: liveShift.id } });
    assert(seededForLive === 0, "expected no duplicate attendance for the covered hours");
    console.log("PASS: a shift still closes with its cash intact when attendance can't be seeded.");

    console.log("\nPASS: attendance seeding from shifts proven against real rows.");
  } finally {
    await cleanUp();
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
