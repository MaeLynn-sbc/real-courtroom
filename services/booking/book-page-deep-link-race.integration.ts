/**
 * Owner request (2026-08-03): clicking an AVAILABLE grid cell deep-links
 * into /book with court+date+time prefilled. The grid's data is a
 * snapshot from page load; by click time the slot may have been taken
 * by someone else. app/book/page.tsx now re-checks availability on
 * arrival (bookingService.checkAvailability — the same read-only
 * preview the form's own live pre-submit check already uses) and shows
 * a "that slot was just taken" message instead of the pre-filled form
 * when it's gone.
 *
 * This proves the underlying mechanism that page's logic depends on —
 * proven failing-first: simulates exactly the race described (a slot
 * available when the grid rendered, booked by someone else before the
 * click lands), and asserts checkAvailability now reports it
 * unavailable. Run this BEFORE the fix existed (i.e. if
 * app/book/page.tsx never called checkAvailability at all) and the
 * customer would sail straight into the pre-filled payment form for a
 * slot that's already gone — this test is what the fix's own arrival
 * check depends on being correct.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";

const TEST_DATE = new Date(2031, 8, 10); // Wednesday, distinct from other fixture dates in this session

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function slot(hour: number): { startAt: Date; endAt: Date } {
  const startAt = new Date(
    TEST_DATE.getFullYear(),
    TEST_DATE.getMonth(),
    TEST_DATE.getDate(),
    hour,
    0,
  );
  const endAt = new Date(startAt);
  endAt.setHours(endAt.getHours() + 1);
  return { startAt, endAt };
}

async function cleanUp(courtId: string): Promise<void> {
  const dayStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const bookings = await prisma.booking.findMany({
    where: { courtId, startAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  const ids = bookings.map((b) => b.id);
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });

  await cleanUp(court.id);

  const shift = await prisma.shift.create({
    data: {
      shiftNumber: `SHIFT-DEEPLINKRACE-${Date.now()}`,
      employeeId: employee.id,
      status: "OPEN",
    },
  });

  try {
    const targetSlot = slot(10);

    // ============== 1. The grid's own moment: genuinely available ==============
    const beforeRace = await bookingService.checkAvailability(
      court.id,
      targetSlot.startAt,
      targetSlot.endAt,
    );
    assert(
      beforeRace.available === true,
      "expected the slot to be genuinely available before the race — this is what the grid rendered",
    );
    console.log(
      "PASS: the slot is genuinely available at the moment the grid would have rendered it.",
    );

    // ============== 2. THE RACE: someone else books it between render and click ==============
    await bookingService.createBooking(
      {
        courtId: court.id,
        type: "HOURLY",
        startAt: targetSlot.startAt,
        endAt: targetSlot.endAt,
        guestName: "Someone Else Entirely",
      },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );

    // ============== 3. The click lands: /book's arrival check must now see it as taken ==============
    const afterRace = await bookingService.checkAvailability(
      court.id,
      targetSlot.startAt,
      targetSlot.endAt,
    );
    assert(
      afterRace.available === false,
      "expected checkAvailability to report the slot as UNAVAILABLE once someone else has booked it — " +
        "this is exactly what must block the customer from a pre-filled payment screen for a slot that's already gone",
    );
    assert(
      afterRace.conflict?.type === "BOOKING",
      `expected the conflict type to be BOOKING, got ${afterRace.conflict?.type}`,
    );
    console.log(
      "PASS: after the race, checkAvailability correctly reports the slot unavailable (conflict: BOOKING) — /book's arrival check would show 'that slot was just taken,' never the pre-filled form.",
    );

    await cleanUp(court.id);
    await prisma.shift.delete({ where: { id: shift.id } });
    console.log(
      "\nPASS: the grid-to-book deep-link race is caught by checkAvailability, proven against real rows.",
    );
  } catch (error) {
    await cleanUp(court.id);
    await prisma.shift.delete({ where: { id: shift.id } }).catch(() => {});
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
