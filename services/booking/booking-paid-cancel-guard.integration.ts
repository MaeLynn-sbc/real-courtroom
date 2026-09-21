/**
 * Real incident (2026-09-13, diagnosed 2026-09-22). Staff settled a
 * booking for PHP 700 by GCash, spotted the wrong time a minute later,
 * CANCELLED it and booked the correct slot — settling a second PHP 700
 * for the same single payment. Cancelling is a bare status flip, so the
 * first sale stayed COMPLETED: the money kept counting as revenue, that
 * night's GCash reconciliation came out PHP 700 short, and the only
 * record of why was a staff note on the variance. The proper refund
 * path existed but was wired to nothing, so nobody could reach it.
 *
 * Proves, against real rows:
 *   1. Cancelling a PAID booking is refused, and nothing changes — the
 *      booking stays CONFIRMED and its sale stays COMPLETED.
 *   2. NO_SHOW on a paid booking is still allowed (the venue keeps it).
 *   3. Cancelling an UNPAID booking still works exactly as before.
 *   4. Refunding is refused once that day's reconciliation is confirmed,
 *      and writes nothing — the owner's "a confirmed day is a number
 *      someone signed off on" rule, which the refund path used to skip.
 *   5. With the day reopened, the refund goes through: sale voided,
 *      BookingRefund recorded, booking REFUNDED.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { saleService } from "../sales/sale.service";
import { bookingRefundService } from "./booking-refund.service";
import { BookingPaidCannotCancelError, bookingService } from "./booking.service";
import { getWebsiteBookingContext } from "./website-identity";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

// A Sunday far enough out not to collide with real usage or other
// fixtures, and on its own date so the daily-balance row this test
// confirms and deletes can never be a real one.
const TEST_DATE = new Date(2031, 8, 14);
const REFERENCE_PREFIX = `BK-TESTPAIDCANCEL-${Date.now()}`;

function at(hour: number): Date {
  return new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hour, 0);
}

const bookingIds: string[] = [];

async function cleanUp(): Promise<void> {
  await prisma.bookingRefund.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.sale.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.gcashDailyBalance.deleteMany({ where: { date: TEST_DATE } });
}

async function createBooking(
  courtId: string,
  bookedById: string,
  startAt: Date,
  endAt: Date,
  suffix: string,
): Promise<string> {
  const booking = await prisma.booking.create({
    data: {
      bookingReference: `${REFERENCE_PREFIX}-${suffix}`,
      courtId,
      bookedById,
      type: "HOURLY",
      status: "CONFIRMED",
      source: "PUBLIC",
      startAt,
      endAt,
      guestName: "Paid Cancel Guard Guest",
      guestPhone: "09171110040",
      totalAmountCents: 70000,
    },
  });
  bookingIds.push(booking.id);
  return booking.id;
}

async function main(): Promise<void> {
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });
  const websiteContext = await getWebsiteBookingContext();

  await prisma.booking.deleteMany({
    where: { bookingReference: { startsWith: "BK-TESTPAIDCANCEL-" } },
  });

  try {
    const paidBookingId = await createBooking(
      court.id,
      websiteContext.userId,
      at(14),
      at(16),
      "PAID",
    );
    const paidSale = await saleService.createSale({
      category: "BOOKING",
      source: "WEBSITE",
      amountCents: 70000,
      paymentMethodId: gcashMethod.id,
      employeeId: websiteContext.employeeId,
      shiftId: websiteContext.shiftId,
      bookingId: paidBookingId,
      // Pins the sale into TEST_DATE's own GCash bucket — the whole point
      // of case 4 is which day's reconciliation would be rewritten.
      createdAt: at(14),
    });

    // ============== 1. Cancelling a paid booking is refused ==============
    let refused = false;
    try {
      await bookingService.updateBookingStatus(paidBookingId, "CANCELLED", websiteContext.userId);
    } catch (error) {
      refused = error instanceof BookingPaidCannotCancelError;
      assert(
        refused,
        `expected BookingPaidCannotCancelError, got ${(error as Error).name}: ${(error as Error).message}`,
      );
    }
    assert(refused, "cancelling a paid booking must be refused");
    const afterRefusal = await prisma.booking.findUniqueOrThrow({ where: { id: paidBookingId } });
    const saleAfterRefusal = await prisma.sale.findUniqueOrThrow({ where: { id: paidSale.id } });
    assert(
      afterRefusal.status === "CONFIRMED" && afterRefusal.cancelledAt === null,
      `the booking must be untouched, got ${afterRefusal.status}`,
    );
    assert(
      saleAfterRefusal.status === "COMPLETED",
      "the sale must be untouched by a refused cancel",
    );
    console.log("PASS: cancelling a paid booking is refused and nothing is written.");

    // ============== 2. NO_SHOW on a paid booking still works ==============
    const noShowBookingId = await createBooking(
      court.id,
      websiteContext.userId,
      at(18),
      at(19),
      "NOSHOW",
    );
    await saleService.createSale({
      category: "BOOKING",
      source: "WEBSITE",
      amountCents: 35000,
      paymentMethodId: gcashMethod.id,
      employeeId: websiteContext.employeeId,
      shiftId: websiteContext.shiftId,
      bookingId: noShowBookingId,
      createdAt: at(18),
    });
    const noShow = await bookingService.updateBookingStatus(
      noShowBookingId,
      "NO_SHOW",
      websiteContext.userId,
    );
    assert(noShow.status === "NO_SHOW", "a paid booking can still be marked no-show");
    console.log("PASS: a paid booking can still be marked no-show — the venue keeps that money.");

    // ============== 3. An unpaid booking still cancels ==============
    const unpaidBookingId = await createBooking(
      court.id,
      websiteContext.userId,
      at(20),
      at(21),
      "UNPAID",
    );
    const cancelled = await bookingService.updateBookingStatus(
      unpaidBookingId,
      "CANCELLED",
      websiteContext.userId,
    );
    assert(cancelled.status === "CANCELLED", "an unpaid booking must still be cancellable");
    console.log("PASS: cancelling an unpaid booking is unchanged.");

    // ============== 4. Refund is refused on a confirmed day ==============
    await prisma.gcashDailyBalance.create({
      data: {
        date: TEST_DATE,
        startingBalanceCents: 0,
        expectedEndingBalanceCents: 105000,
        confirmedEndingBalanceCents: 105000,
        varianceCents: 0,
        status: "CONFIRMED",
        confirmedAt: at(23),
        notes: REFERENCE_PREFIX,
      },
    });
    let blocked = false;
    try {
      await bookingRefundService.refundBooking(
        paidBookingId,
        "duplicate booking",
        websiteContext.employeeId,
        websiteContext.userId,
      );
    } catch (error) {
      blocked = true;
      const message = (error as Error).message;
      assert(
        message.includes("already confirmed") && message.includes("reopen"),
        `expected a reopen-first message, got "${message}"`,
      );
    }
    assert(blocked, "refunding into an already-confirmed GCash day must be refused");
    const stillPaid = await prisma.sale.findUniqueOrThrow({ where: { id: paidSale.id } });
    const refundRows = await prisma.bookingRefund.count({ where: { bookingId: paidBookingId } });
    assert(
      stillPaid.status === "COMPLETED" && refundRows === 0,
      "a blocked refund must write nothing at all",
    );
    console.log("PASS: a refund into a signed-off day is refused, and writes nothing.");

    // ============== 5. Reopened, the refund goes through ==============
    await prisma.gcashDailyBalance.update({
      where: { date: TEST_DATE },
      data: { status: "OPEN", confirmedEndingBalanceCents: null, varianceCents: null },
    });
    const { booking: refundedBooking, refund } = await bookingRefundService.refundBooking(
      paidBookingId,
      "duplicate booking — wrong time, rebooked",
      websiteContext.employeeId,
      websiteContext.userId,
    );
    const voidedSale = await prisma.sale.findUniqueOrThrow({ where: { id: paidSale.id } });
    assert(
      refundedBooking.status === "REFUNDED" && voidedSale.status === "VOID",
      `expected REFUNDED + VOID, got ${refundedBooking.status} + ${voidedSale.status}`,
    );
    assert(
      refund.amountCents === 70000,
      `the refund records the full amount, got ${refund.amountCents}`,
    );
    console.log(
      `PASS: with the day reopened the refund goes through — ₱${refund.amountCents / 100} voided and recorded.`,
    );
  } finally {
    await cleanUp();
  }

  console.log("PASS: a paid booking can no longer be cancelled out from under its payment.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUp().catch(() => {});
  process.exit(1);
});
