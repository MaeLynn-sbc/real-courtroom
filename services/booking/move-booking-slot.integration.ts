/**
 * Owner request (2026-08-25): "can we make the staff change the court even
 * if it's booked thru website. also the time if possible", with the rule
 * "once it's already paid, make sure the changes can only be different
 * time slot diff court but same number of hours", and "not the past".
 *
 * The website was never the blocker — changeBookingCourt already handled
 * PUBLIC bookings. What blocked them was `if (existing.sale) throw`, and a
 * website booking gets its Sale the moment staff approve the payment
 * proof. So every PAID booking was unmovable, website or not.
 *
 * Proves, against real rows:
 *   1. A PAID booking moves to a different court AND time, same duration.
 *      This is the case that was impossible before.
 *   2. A PAID booking is REFUSED a duration change (the owner's rule),
 *      and the message names both lengths.
 *   3. An UNPAID booking may change duration freely, price recomputed.
 *   4. Moving into the past is refused, paid or not.
 *   5. A move onto an occupied court/time is still refused.
 *   6. A terminal-status booking is still refused.
 *   7. A successful move writes an audit log entry and a history note.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService, BookingConflictError } from "./booking.service";
import { saleService } from "../sales/sale.service";

// Far future, so "not the past" is never accidentally true.
const TEST_DATE = new Date(2032, 2, 17);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function slot(hour: number, durationMinutes = 60): { startAt: Date; endAt: Date } {
  const startAt = new Date(
    TEST_DATE.getFullYear(),
    TEST_DATE.getMonth(),
    TEST_DATE.getDate(),
    hour,
    0,
  );
  return { startAt, endAt: new Date(startAt.getTime() + durationMinutes * 60_000) };
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
  assert(courts.length >= 3, "expected at least 3 courts");
  const [courtA, courtB, courtC] = courts;

  const shift = await prisma.shift.create({
    data: {
      shiftNumber: `SHIFT-MOVESLOT-${Date.now()}`,
      employeeId: employee.id,
      status: "OPEN",
      openingCashCents: 0,
    },
  });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const bookingIds: string[] = [];

  // A booking that has really been paid — a Sale row against it, exactly
  // as approving a website payment proof produces.
  async function makePaidBooking(courtId: string, at: { startAt: Date; endAt: Date }) {
    const booking = await bookingService.createBooking(
      { courtId, type: "HOURLY", startAt: at.startAt, endAt: at.endAt, guestName: "Paid Guest" },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    bookingIds.push(booking.id);
    await saleService.createSale({
      category: "BOOKING",
      amountCents: booking.totalAmountCents ?? 0,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      bookingId: booking.id,
    });
    return booking;
  }

  try {
    // ============== 1. PAID booking moves court AND time ==============
    const paid = await makePaidBooking(courtA.id, slot(9));
    const target = slot(14);
    const moved = await bookingService.changeBookingSlot(
      paid.id,
      { newCourtId: courtB.id, newStartAt: target.startAt, newEndAt: target.endAt },
      owner.id,
    );
    assert(moved.courtId === courtB.id, `expected court ${courtB.id}, got ${moved.courtId}`);
    assert(
      moved.startAt.getTime() === target.startAt.getTime(),
      "expected the start time to move",
    );
    assert(
      moved.totalAmountCents === paid.totalAmountCents,
      `expected the price to be unchanged (${paid.totalAmountCents}), got ${moved.totalAmountCents}`,
    );
    console.log("PASS: an already-paid booking moves to a different court AND time, price unchanged.");

    // ============== 2. PAID booking refuses a duration change ==============
    let durationRefused = false;
    const longer = slot(16, 120);
    try {
      await bookingService.changeBookingSlot(
        paid.id,
        { newStartAt: longer.startAt, newEndAt: longer.endAt },
        owner.id,
      );
    } catch (error) {
      durationRefused = true;
      assert(
        String(error).includes("same length"),
        `expected a same-length error, got ${error}`,
      );
    }
    assert(durationRefused, "expected a paid booking to refuse a change of duration");
    console.log("PASS: an already-paid booking refuses a duration change, naming both lengths.");

    // ============== 3. UNPAID booking may change duration ==============
    const unpaid = await bookingService.createBooking(
      { courtId: courtA.id, type: "HOURLY", ...slot(19), guestName: "Unpaid Guest" },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    bookingIds.push(unpaid.id);
    const resized = slot(20, 120);
    const resizedBooking = await bookingService.changeBookingSlot(
      unpaid.id,
      { newStartAt: resized.startAt, newEndAt: resized.endAt },
      owner.id,
    );
    assert(
      (resizedBooking.totalAmountCents ?? 0) > (unpaid.totalAmountCents ?? 0),
      "expected an unpaid booking's price to be recomputed upward for a longer slot",
    );
    console.log("PASS: an unpaid booking may change duration — the price is recomputed.");

    // ============== 4. Moving into the past is refused ==============
    let pastRefused = false;
    try {
      const pastSlot = slot(9);
      await bookingService.changeBookingSlot(
        unpaid.id,
        { newStartAt: pastSlot.startAt, newEndAt: pastSlot.endAt },
        owner.id,
        // "now" is well after the fixture date, so this slot is the past.
        new Date(TEST_DATE.getFullYear() + 1, 0, 1),
      );
    } catch (error) {
      pastRefused = true;
      assert(String(error).includes("into the past"), `expected a past error, got ${error}`);
    }
    assert(pastRefused, "expected a move into the past to be refused");
    console.log("PASS: moving a booking into the past is refused.");

    // ============== 5. Moving onto an occupied slot is refused ==============
    const blockerSlot = slot(7);
    const blocker = await bookingService.createBooking(
      { courtId: courtC.id, type: "HOURLY", ...blockerSlot, guestName: "Blocker" },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    bookingIds.push(blocker.id);

    let conflictRefused = false;
    try {
      await bookingService.changeBookingSlot(
        paid.id,
        { newCourtId: courtC.id, newStartAt: blockerSlot.startAt, newEndAt: blockerSlot.endAt },
        owner.id,
      );
    } catch (error) {
      conflictRefused = error instanceof BookingConflictError;
    }
    assert(conflictRefused, "expected a move onto an occupied court/time to be refused");
    console.log("PASS: a move onto an already-booked court and time is still refused.");

    // ============== 6. Terminal status refused ==============
    await prisma.booking.update({ where: { id: blocker.id }, data: { status: "CANCELLED" } });
    let terminalRefused = false;
    try {
      await bookingService.changeBookingSlot(blocker.id, { newCourtId: courtA.id }, owner.id);
    } catch (error) {
      terminalRefused = String(error).includes("cancelled");
    }
    assert(terminalRefused, "expected a cancelled booking to refuse a move");
    console.log("PASS: a terminal-status booking still refuses a move.");

    // ============== 7. Audit log + history note ==============
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Booking", entityId: paid.id, action: "booking.slot_changed" },
    });
    assert(audit, "expected a booking.slot_changed audit log entry");
    const history = await prisma.bookingHistory.findFirst({
      where: { bookingId: paid.id, note: { startsWith: "Moved" } },
    });
    assert(history, "expected a BookingHistory note recording the move");
    console.log("PASS: a successful move is audit-logged and recorded in booking history.");

    console.log("\nPASS: booking slot moves proven against real rows.");
  } finally {
    await cleanUp(bookingIds);
    await prisma.sale.deleteMany({ where: { shiftId: shift.id } });
    await prisma.shift.delete({ where: { id: shift.id } }).catch(() => undefined);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
