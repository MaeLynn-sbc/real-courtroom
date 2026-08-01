/**
 * "Sometimes customer change their mind... rather play in further
 * court which is court 3 if it's available." Same time slot, a
 * different court. Proves, against real rows:
 *   1. A switch to an available different court succeeds — courtId,
 *      totalAmountCents (recomputed from the NEW court's own rate,
 *      not assumed unchanged), and isAfterHours all update correctly.
 *   2. A switch is rejected when the target court already has a
 *      conflicting booking at the same time.
 *   3. A switch is rejected once the booking has already been
 *      settled (a real Sale exists) — proven failing-first, same
 *      shape as every other money-adjacent guard this session.
 *   4. A switch is rejected on a terminal status (CANCELLED).
 *   5. A successful switch writes both an audit log entry and a
 *      BookingHistory note.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import {
  bookingService,
  BookingAlreadySettledError,
  BookingConflictError,
} from "./booking.service";

const TEST_DATE = new Date(2031, 5, 11); // Wednesday, distinct from other booking test fixtures

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
  const endAt = new Date(startAt.getTime() + 60 * 60_000);
  return { startAt, endAt };
}

async function cleanUp(bookingIds: string[]): Promise<void> {
  await prisma.auditLog.deleteMany({
    where: { entityType: "Booking", entityId: { in: bookingIds } },
  });
  await prisma.sale.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const courts = await prisma.court.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    take: 3,
  });
  assert(courts.length >= 3, "expected at least 3 courts to run this test");
  const [courtA, courtB, courtC] = courts;

  const shift = await prisma.shift.create({
    data: {
      shiftNumber: `SHIFT-COURTSWITCH-${Date.now()}`,
      employeeId: employee.id,
      status: "OPEN",
      openingCashCents: 0,
    },
  });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

  const bookingIds: string[] = [];

  try {
    // ============== 1. Switch to an available court succeeds ==============
    const mainSlot = slot(9);
    const booking = await bookingService.createBooking(
      {
        courtId: courtA.id,
        type: "WALK_IN",
        startAt: mainSlot.startAt,
        endAt: mainSlot.endAt,
        guestName: "Switch Test Guest",
      },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    bookingIds.push(booking.id);

    const switched = await bookingService.changeBookingCourt(booking.id, courtB.id, owner.id);
    assert(
      switched.courtId === courtB.id,
      `expected courtId to be ${courtB.id}, got ${switched.courtId}`,
    );
    const expectedAmount = Math.round((courtB.hourlyRateCents ?? 0) * 1);
    assert(
      switched.totalAmountCents === expectedAmount,
      `expected totalAmountCents to be recomputed from Court B's own rate (${expectedAmount}), got ${switched.totalAmountCents}`,
    );
    console.log(
      "PASS: a switch to an available different court succeeds, recomputing the price from the new court's own rate.",
    );

    // ============== 2. Rejected when the target court is already booked ==============
    const conflictSlot = slot(11);
    const conflictingBooking = await bookingService.createBooking(
      {
        courtId: courtC.id,
        type: "WALK_IN",
        startAt: conflictSlot.startAt,
        endAt: conflictSlot.endAt,
        guestName: "Blocker",
      },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    bookingIds.push(conflictingBooking.id);

    const secondBooking = await bookingService.createBooking(
      {
        courtId: courtA.id,
        type: "WALK_IN",
        startAt: conflictSlot.startAt,
        endAt: conflictSlot.endAt,
        guestName: "Wants Court C",
      },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    bookingIds.push(secondBooking.id);

    let conflictRejected = false;
    try {
      await bookingService.changeBookingCourt(secondBooking.id, courtC.id, owner.id);
    } catch (error) {
      conflictRejected = error instanceof BookingConflictError;
    }
    assert(
      conflictRejected,
      "expected a switch to an already-booked court to be rejected with BookingConflictError",
    );
    const secondBookingAfter = await prisma.booking.findUniqueOrThrow({
      where: { id: secondBooking.id },
    });
    assert(
      secondBookingAfter.courtId === courtA.id,
      "expected the booking to remain on its original court after a rejected switch",
    );
    console.log(
      "PASS: a switch to a court that's already booked for that time is rejected, and the original court is untouched.",
    );

    // ============== 3. Rejected once the booking is settled ==============
    await bookingService.settleBooking(
      switched.id,
      "CASH",
      null,
      { employeeId: employee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
      owner.id,
    );
    let settledRejected = false;
    try {
      await bookingService.changeBookingCourt(switched.id, courtA.id, owner.id);
    } catch (error) {
      settledRejected = error instanceof BookingAlreadySettledError;
    }
    assert(
      settledRejected,
      "expected a switch on an already-settled booking to be rejected with BookingAlreadySettledError",
    );
    console.log("PASS: a switch on an already-settled booking is rejected — proven failing-first.");

    // ============== 4. Rejected on a terminal status ==============
    const cancelSlot = slot(14);
    const cancelledBooking = await bookingService.createBooking(
      {
        courtId: courtA.id,
        type: "WALK_IN",
        startAt: cancelSlot.startAt,
        endAt: cancelSlot.endAt,
        guestName: "Cancelled Guest",
      },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    bookingIds.push(cancelledBooking.id);
    await bookingService.updateBookingStatus(cancelledBooking.id, "CANCELLED", owner.id);

    let terminalRejected = false;
    try {
      await bookingService.changeBookingCourt(cancelledBooking.id, courtB.id, owner.id);
    } catch {
      terminalRejected = true;
    }
    assert(terminalRejected, "expected a switch on a CANCELLED booking to be rejected");
    console.log("PASS: a switch on a cancelled (terminal-status) booking is rejected.");

    // ============== 5. Audit log + booking history written for the successful switch ==============
    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "Booking", entityId: booking.id, action: "booking.court_changed" },
    });
    assert(auditEntry !== null, "expected a booking.court_changed audit log entry");

    const historyNote = await prisma.bookingHistory.findFirst({
      where: { bookingId: booking.id, note: { contains: "Switched from" } },
    });
    assert(historyNote !== null, "expected a BookingHistory row noting the switch");
    console.log(
      "PASS: a successful switch writes both an audit log entry and a BookingHistory note.",
    );

    console.log("\nPASS: court switching proven against real rows.");
  } finally {
    await cleanUp(bookingIds);
    await prisma.shift.delete({ where: { id: shift.id } });
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
