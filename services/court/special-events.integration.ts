/**
 * Owner request (2026-08-08): "block courts for a special event, shown
 * publicly as 'Booked for special events' instead of the generic
 * maintenance label." Extends CourtMaintenance (kind: SPECIAL_EVENT)
 * rather than a new model — reuses every existing conflict-detection
 * path.
 *
 * Proves, against real rows:
 *   1. scheduleSpecialEvent creates one CourtMaintenance row per
 *      selected court, kind SPECIAL_EVENT, sharing the same reason/
 *      window.
 *   2. checkAvailability rejects a booking attempt overlapping a
 *      special event block, with conflict.type === "SPECIAL_EVENT" —
 *      not the generic "MAINTENANCE" a customer/staff would otherwise
 *      see.
 *   3. Regular maintenance (kind MAINTENANCE, unchanged) still rejects
 *      with conflict.type === "MAINTENANCE" — this feature didn't touch
 *      the existing behavior.
 *   4. getPublicDaySchedule's maintenanceRanges marks the special
 *      event's window isSpecialEvent: true, and a plain maintenance
 *      window isSpecialEvent: false.
 *   5. updateSpecialEventTiming edits one row's window in place
 *      (reason/courtId/kind untouched), and the new window is what
 *      actually gets enforced by checkAvailability — the old window no
 *      longer conflicts.
 *   6. deleteSpecialEvent refuses to delete a non-cancelled row, but
 *      succeeds (real row gone) once it's CANCELLED.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "../booking/booking.service";
import { courtService } from "./court.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const MARKER = `special-events-test-${Date.now()}`;

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, take: 2 });
  assert(courts.length >= 2, "expected at least 2 real courts to exist for this test");
  const [courtA, courtB] = courts;

  // A fixed, far-future date/time window, isolated from any real business
  // activity — Sunday (never Fri/Sat capacity night, never a maintenance
  // fixture another test might collide with).
  const startAt = new Date(2031, 5, 1, 10, 0); // Sunday, June 1 2031, 10am
  const endAt = new Date(2031, 5, 1, 12, 0);

  const maintenanceIdsToClean: string[] = [];

  try {
    // ============== 1. scheduleSpecialEvent creates one row per court ==============
    const records = await courtService.scheduleSpecialEvent(
      {
        kind: "SPECIAL_EVENT" as const,
        courtIds: [courtA!.id, courtB!.id],
        reason: `${MARKER} tournament`,
        notes: "test",
        startAt,
        endAt,
      },
      owner.id,
    );
    maintenanceIdsToClean.push(...records.map((r) => r.id));
    assert(records.length === 2, `expected 2 CourtMaintenance rows (one per court), got ${records.length}`);
    assert(
      records.every((r) => r.kind === "SPECIAL_EVENT"),
      "expected every created row to have kind SPECIAL_EVENT",
    );
    assert(
      records.every((r) => r.reason === `${MARKER} tournament`),
      "expected both rows to share the same reason",
    );
    console.log("PASS: scheduleSpecialEvent creates one CourtMaintenance row per selected court, kind SPECIAL_EVENT.");

    // ============== 2. checkAvailability rejects with SPECIAL_EVENT, not MAINTENANCE ==============
    const resultA = await bookingService.checkAvailability(courtA!.id, startAt, endAt);
    assert(resultA.available === false, "expected the special-event-blocked court to be unavailable");
    assert(
      resultA.conflict?.type === "SPECIAL_EVENT",
      `expected conflict.type SPECIAL_EVENT, got ${resultA.conflict?.type}`,
    );
    console.log("PASS: checkAvailability rejects a booking attempt overlapping a special event, with conflict.type SPECIAL_EVENT.");

    // A court NOT included in the special event stays unaffected.
    const [, , courtC] = await prisma.court.findMany({ where: { deletedAt: null }, take: 3 });
    if (courtC) {
      const resultC = await bookingService.checkAvailability(courtC.id, startAt, endAt);
      assert(resultC.available === true, "expected a court not part of the special event to remain available");
      console.log("PASS: a court not included in the special event is unaffected.");
    }

    // ============== 3. Regular maintenance (unchanged) still reports MAINTENANCE ==============
    const plainMaintenance = await courtService.scheduleMaintenance(
      courtA!.id,
      { reason: `${MARKER} plain maintenance`, notes: undefined, startAt: new Date(2031, 5, 2, 10, 0), endAt: new Date(2031, 5, 2, 12, 0) },
      owner.id,
    );
    maintenanceIdsToClean.push(plainMaintenance.id);
    const resultPlain = await bookingService.checkAvailability(
      courtA!.id,
      new Date(2031, 5, 2, 10, 0),
      new Date(2031, 5, 2, 12, 0),
    );
    assert(
      resultPlain.conflict?.type === "MAINTENANCE",
      `expected plain maintenance to still report conflict.type MAINTENANCE (unchanged), got ${resultPlain.conflict?.type}`,
    );
    console.log("PASS: regular maintenance (kind MAINTENANCE, unchanged) still reports conflict.type MAINTENANCE.");

    // ============== 4. getPublicDaySchedule marks isSpecialEvent correctly ==============
    const publicSchedule = await bookingService.getPublicDaySchedule(startAt);
    const courtASchedule = publicSchedule.find((s) => s.courtId === courtA!.id);
    const eventRange = courtASchedule?.maintenanceRanges.find(
      (r) => r.startAt.getTime() === startAt.getTime(),
    );
    assert(eventRange, "expected the special event window to appear in getPublicDaySchedule's maintenanceRanges");
    assert(eventRange!.isSpecialEvent === true, "expected the special event range to be marked isSpecialEvent: true");

    const plainSchedule = await bookingService.getPublicDaySchedule(new Date(2031, 5, 2, 0, 0));
    const courtAPlainSchedule = plainSchedule.find((s) => s.courtId === courtA!.id);
    const plainRange = courtAPlainSchedule?.maintenanceRanges.find(
      (r) => r.startAt.getTime() === new Date(2031, 5, 2, 10, 0).getTime(),
    );
    assert(plainRange, "expected the plain maintenance window to appear in getPublicDaySchedule's maintenanceRanges");
    assert(plainRange!.isSpecialEvent === false, "expected the plain maintenance range to be marked isSpecialEvent: false");
    console.log("PASS: getPublicDaySchedule correctly marks isSpecialEvent per range — special event true, plain maintenance false.");

    // ============== 5. updateSpecialEventTiming edits the window in place ==============
    const newStartAt = new Date(2031, 5, 1, 14, 0);
    const newEndAt = new Date(2031, 5, 1, 16, 0);
    const updated = await courtService.updateSpecialEventTiming(records[0]!.id, newStartAt, newEndAt, owner.id);
    assert(
      updated.startAt.getTime() === newStartAt.getTime() && updated.endAt.getTime() === newEndAt.getTime(),
      "expected updateSpecialEventTiming to persist the new window",
    );
    assert(
      updated.courtId === records[0]!.courtId && updated.reason === records[0]!.reason,
      "expected updateSpecialEventTiming to leave courtId/reason untouched",
    );

    const oldWindowNowFree = await bookingService.checkAvailability(courtA!.id, startAt, endAt);
    assert(
      oldWindowNowFree.available === true,
      "expected the ORIGINAL window to no longer conflict after the timing moved away from it",
    );
    const newWindowBlocked = await bookingService.checkAvailability(courtA!.id, newStartAt, newEndAt);
    assert(
      newWindowBlocked.available === false && newWindowBlocked.conflict?.type === "SPECIAL_EVENT",
      "expected the NEW window to now be the one that conflicts",
    );
    console.log(
      "PASS: updateSpecialEventTiming edits one row's window in place, and the new window is what's actually enforced.",
    );

    // ============== 6. deleteSpecialEvent refuses a non-cancelled row, succeeds once cancelled ==============
    let rejectedDeleteOfActive = false;
    try {
      await courtService.deleteSpecialEvent(records[0]!.id, owner.id);
    } catch (error) {
      rejectedDeleteOfActive = true;
      assert(
        String(error).includes("cancelled"),
        `expected a "must be cancelled first" error, got ${error}`,
      );
    }
    assert(rejectedDeleteOfActive, "expected deleteSpecialEvent to refuse deleting a non-cancelled row");

    await courtService.updateMaintenanceStatus(records[0]!.id, "CANCELLED", owner.id);
    await courtService.deleteSpecialEvent(records[0]!.id, owner.id);
    const deletedRow = await prisma.courtMaintenance.findUnique({ where: { id: records[0]!.id } });
    assert(deletedRow === null, "expected the row to be actually gone after deleteSpecialEvent");
    maintenanceIdsToClean.splice(maintenanceIdsToClean.indexOf(records[0]!.id), 1);
    console.log(
      "PASS: deleteSpecialEvent refuses to delete a non-cancelled row, but really deletes once it's CANCELLED.",
    );

    console.log("\nPASS: special events block courts and are distinguishable from plain maintenance, proven against real rows.");
  } finally {
    await prisma.courtMaintenance.deleteMany({ where: { id: { in: maintenanceIdsToClean } } });
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
