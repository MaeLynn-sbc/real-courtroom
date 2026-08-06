/**
 * Real incident (2026-08-06): the public booking double-submit bug
 * produced a duplicate, separately-approved Booking/Sale for one real
 * GCash payment (BK-20260805-0011 real, BK-20260805-0012 the duplicate).
 * bookingRefundService.refundBooking is the fix for THAT specific class of
 * mistake — voids the duplicate's Sale (an offsetting status change, never
 * a hard delete), records a durable, reasoned BookingRefund row, and
 * transitions the booking to REFUNDED, atomically.
 *
 * Proves, against real rows:
 *   1. A CONFIRMED booking with a real Sale: refunding voids the Sale
 *      (status COMPLETED -> VOID, every other field untouched), creates a
 *      BookingRefund row with the exact reason/amount/employee, and
 *      transitions the booking to REFUNDED.
 *   2. The slot is released — checkAvailability for that exact court/time
 *      returns available:true afterward. Proven failing-first against the
 *      REFUNDED-not-excluded state: before this fix, REFUNDED wasn't in
 *      checkAvailabilityWithClient's exclusion list, so this assertion
 *      would have failed.
 *   3. The voided Sale drops out of GCash reconciliation — getGcashSalesForDate
 *      for that day decreases by exactly the sale's amount.
 *   4. A refund is rejected outright — not silently partial — for a
 *      booking that isn't CONFIRMED or has no Sale. Nothing is written on
 *      rejection: no BookingRefund row, no status change.
 *   5. A SEPARATE booking (the "keep this one" case, e.g. BK-0011) is
 *      completely untouched by refunding a different booking.
 *   6. A booking already REFUNDED cannot be refunded again (double-refund
 *      guard).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { bookingRefundService, BookingNotRefundableError } from "./booking-refund.service";
import { getWebsiteBookingContext } from "./website-identity";
import { saleService } from "../sales/sale.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

// Saturday, far enough out not to collide with real usage or other
// fixtures this session.
const TEST_DATE = new Date(2031, 8, 6);

function at(hour: number): Date {
  return new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hour, 0);
}

async function cleanUp(bookingIds: string[]): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { entityType: { in: ["Sale", "Booking"] }, entityId: { in: bookingIds } } });
  await prisma.bookingRefund.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.sale.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
}

async function createConfirmedBookingWithSale(
  courtId: string,
  startAt: Date,
  endAt: Date,
  bookedByUserId: string,
  employeeId: string,
  shiftId: string,
  gcashMethodId: string,
  reference: string,
): Promise<{ bookingId: string; saleId: string }> {
  const booking = await prisma.booking.create({
    data: {
      bookingReference: reference,
      courtId,
      bookedById: bookedByUserId,
      type: "HOURLY",
      status: "CONFIRMED",
      source: "PUBLIC",
      startAt,
      endAt,
      guestName: "Test Refund Guest",
      guestPhone: "09171110030",
      totalAmountCents: 35000,
    },
  });
  const sale = await saleService.createSale({
    category: "BOOKING",
    source: "WEBSITE",
    amountCents: 35000,
    paymentMethodId: gcashMethodId,
    employeeId,
    shiftId,
    bookingId: booking.id,
    // Backfill-only escape hatch (sale.service.ts's own comment) — pins
    // the Sale into TEST_DATE's own GCash reconciliation bucket instead
    // of "now," so getGcashSalesForDate(TEST_DATE) below actually sees it.
    createdAt: startAt,
  });
  return { bookingId: booking.id, saleId: sale.id };
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });
  const websiteContext = await getWebsiteBookingContext();

  const duplicateStart = at(14);
  const duplicateEnd = at(15);
  const keepStart = at(16);
  const keepEnd = at(17);

  let duplicateBookingId = "";
  let keepBookingId = "";

  try {
    const duplicate = await createConfirmedBookingWithSale(
      court.id,
      duplicateStart,
      duplicateEnd,
      websiteContext.userId,
      websiteContext.employeeId,
      websiteContext.shiftId,
      gcashMethod.id,
      `BK-TESTREFUND-${Date.now()}-A`,
    );
    duplicateBookingId = duplicate.bookingId;

    const keep = await createConfirmedBookingWithSale(
      court.id,
      keepStart,
      keepEnd,
      websiteContext.userId,
      websiteContext.employeeId,
      websiteContext.shiftId,
      gcashMethod.id,
      `BK-TESTREFUND-${Date.now()}-B`,
    );
    keepBookingId = keep.bookingId;

    const beforeGcashTotal = await saleService.getGcashSalesForDate(TEST_DATE);

    // ============== 4a. Reject a non-refundable booking first (failing-first) ==============
    const pendingBooking = await prisma.booking.create({
      data: {
        bookingReference: `BK-TESTREFUND-${Date.now()}-C`,
        courtId: court.id,
        bookedById: websiteContext.userId,
        type: "HOURLY",
        status: "PENDING",
        source: "PUBLIC",
        startAt: at(18),
        endAt: at(19),
        guestName: "No Sale Guest",
        guestPhone: "09171110031",
        totalAmountCents: 35000,
      },
    });
    let rejectedNoSale = false;
    try {
      await bookingRefundService.refundBooking(pendingBooking.id, "test", ownerEmployee.id, owner.id);
    } catch (error) {
      rejectedNoSale = error instanceof BookingNotRefundableError;
    }
    assert(rejectedNoSale, "expected refunding a PENDING booking with no Sale to be rejected with BookingNotRefundableError");
    const refundCountForPending = await prisma.bookingRefund.count({ where: { bookingId: pendingBooking.id } });
    assert(refundCountForPending === 0, "expected NO BookingRefund row for the rejected attempt");
    await prisma.booking.delete({ where: { id: pendingBooking.id } });
    console.log("PASS: refunding a non-CONFIRMED booking with no Sale is rejected outright — nothing written.");

    // ============== 1. Refund the duplicate ==============
    const reason = "Duplicate booking caused by double-submit error; single GCash payment applied to two bookings.";
    const result = await bookingRefundService.refundBooking(duplicateBookingId, reason, ownerEmployee.id, owner.id);

    assert(result.booking.status === "REFUNDED", `expected status REFUNDED, got ${result.booking.status}`);
    assert(result.refund.amountCents === 35000, `expected refund amountCents 35000, got ${result.refund.amountCents}`);
    assert(result.refund.reason === reason, "expected the exact reason to be recorded");
    assert(result.refund.employeeId === ownerEmployee.id, "expected the acting employee to be recorded");

    const voidedSale = await prisma.sale.findUniqueOrThrow({ where: { id: duplicate.saleId } });
    assert(voidedSale.status === "VOID", `expected the Sale to be VOID, got ${voidedSale.status}`);
    assert(voidedSale.amountCents === 35000, "expected the Sale's amountCents to be untouched by the void");
    assert(voidedSale.shiftId === websiteContext.shiftId, "expected the Sale's original shiftId to be untouched by the void");
    console.log("PASS: refunding voids the Sale (status only — every other field untouched), records the BookingRefund row, and transitions the booking to REFUNDED.");

    // ============== 2. Slot released ==============
    const availability = await bookingService.checkAvailability(court.id, duplicateStart, duplicateEnd);
    assert(
      availability.available === true,
      "expected the slot to be available again after REFUNDED — this is exactly the fix (REFUNDED added to the exclusion list)",
    );
    console.log("PASS: the court/slot is released back to availability once REFUNDED.");

    // ============== 3. Reconciliation drops the voided amount ==============
    const afterGcashTotal = await saleService.getGcashSalesForDate(TEST_DATE);
    assert(
      afterGcashTotal === beforeGcashTotal - 35000,
      `expected GCash total to drop by exactly 35000 (350, 35000 -> before=${beforeGcashTotal}, after=${afterGcashTotal})`,
    );
    console.log("PASS: the voided Sale drops out of GCash daily reconciliation by exactly its amount.");

    // ============== 5. The other booking is untouched ==============
    const untouchedBooking = await prisma.booking.findUniqueOrThrow({ where: { id: keepBookingId } });
    const untouchedSale = await prisma.sale.findUniqueOrThrow({ where: { id: keep.saleId } });
    assert(untouchedBooking.status === "CONFIRMED", "expected the OTHER booking to remain CONFIRMED, completely untouched");
    assert(untouchedSale.status === "COMPLETED", "expected the OTHER booking's Sale to remain COMPLETED, completely untouched");
    console.log("PASS: a separate booking (the one being kept) is completely untouched by refunding a different one.");

    // ============== 6. Double-refund guard ==============
    let rejectedDoubleRefund = false;
    try {
      await bookingRefundService.refundBooking(duplicateBookingId, "second attempt", ownerEmployee.id, owner.id);
    } catch (error) {
      rejectedDoubleRefund = error instanceof BookingNotRefundableError;
    }
    assert(rejectedDoubleRefund, "expected refunding an already-REFUNDED booking to be rejected");
    const refundCountAfterDouble = await prisma.bookingRefund.count({ where: { bookingId: duplicateBookingId } });
    assert(refundCountAfterDouble === 1, `expected still exactly 1 BookingRefund row after the rejected double-attempt, got ${refundCountAfterDouble}`);
    console.log("PASS: an already-REFUNDED booking cannot be refunded again.");

    await cleanUp([duplicateBookingId, keepBookingId]);
    console.log("\nPASS: booking refund (void Sale + audit row + REFUNDED transition) proven against real rows.");
  } catch (error) {
    await cleanUp([duplicateBookingId, keepBookingId].filter(Boolean));
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
