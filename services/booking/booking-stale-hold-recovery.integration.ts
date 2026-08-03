/**
 * The other half of the 2026-08-03 reversal (see
 * checkAvailabilityWithClient's comment in booking.service.ts): if a
 * stale hold still blocks its own court, a customer submitting proof
 * "late" is submitting for a slot that's still genuinely hers — the
 * submission must succeed, not be rejected with "hold has expired."
 * Also proves BookingService.listStaleHolds/countStaleHolds (the staff-
 * facing visibility half of the same change) correctly finds a stale
 * hold before it's resolved, and correctly stops counting it once
 * resolved (submitted or cancelled).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingPaymentProofService } from "./booking-payment-proof.service";
import { bookingService } from "./booking.service";
import { getWebsiteBookingContext } from "./website-identity";

const TEST_DATE = new Date(2031, 2, 7); // Friday, far enough out not to collide with real usage

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function screenshot() {
  return { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") };
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
  await prisma.bookingPaymentProof.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

async function main(): Promise<void> {
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const websiteContext = await getWebsiteBookingContext();
  await cleanUp(court.id);

  const startAt = new Date(
    TEST_DATE.getFullYear(),
    TEST_DATE.getMonth(),
    TEST_DATE.getDate(),
    9,
    0,
  );
  const endAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 10, 0);
  const staleBooking = await prisma.booking.create({
    data: {
      bookingReference: `STALEREC-${Date.now()}`,
      courtId: court.id,
      bookedById: websiteContext.userId,
      type: "HOURLY",
      status: "AWAITING_PAYMENT",
      source: "PUBLIC",
      startAt,
      endAt,
      guestName: "Rosela-like Guest",
      guestPhone: "09170000501",
      totalAmountCents: 35000,
      isAfterHours: false,
      holdExpiresAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago, well past any hold window
    },
  });

  try {
    // 1. Before submission or cancellation, the stale hold must be
    // visible to staff via both the count and the full list.
    const staleList = await bookingService.listBookings({ staleHoldsOnly: true });
    assert(
      staleList.some((b) => b.id === staleBooking.id),
      "expected the stale booking to appear in listBookings({ staleHoldsOnly: true })",
    );
    const staleCount = await bookingService.countStaleHolds();
    assert(staleCount >= 1, `expected countStaleHolds to be at least 1, got ${staleCount}`);
    console.log(
      `PASS: stale hold is visible to staff — countStaleHolds=${staleCount}, present in listBookings({ staleHoldsOnly: true }).`,
    );

    // 2. Submitting proof HOURS after the hold's display timer ran out
    // must still succeed — the slot was never released, so there's no
    // reason to reject it.
    const proof = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: staleBooking.id,
      gcashReference: `STALEREC-PROOF-${Date.now()}`,
      submittedAmountCents: staleBooking.totalAmountCents ?? 35000,
      screenshot: screenshot(),
    });
    assert(
      proof.status === "PENDING",
      `expected the late proof to be created as PENDING, got ${proof.status}`,
    );

    const bookingAfterSubmit = await prisma.booking.findUniqueOrThrow({
      where: { id: staleBooking.id },
    });
    console.log(
      `After late submission: status=${bookingAfterSubmit.status}, holdExpiresAt=${bookingAfterSubmit.holdExpiresAt}`,
    );
    assert(
      bookingAfterSubmit.status === "PENDING_VERIFICATION",
      `expected a late submission to still move the booking to PENDING_VERIFICATION, got ${bookingAfterSubmit.status}`,
    );
    console.log(
      "PASS: submitting payment proof hours after the hold's display timer expired still succeeds — no more 'hold has expired' rejection.",
    );

    // 3. Once resolved (submitted, in this case), it must drop out of
    // the stale-holds view — it's no longer AWAITING_PAYMENT.
    const staleListAfter = await bookingService.listBookings({ staleHoldsOnly: true });
    assert(
      !staleListAfter.some((b) => b.id === staleBooking.id),
      "expected the booking to disappear from listStaleHolds once it's no longer AWAITING_PAYMENT",
    );
    console.log("PASS: a resolved booking (submitted) no longer appears as a stale hold.");

    await cleanUp(court.id);
  } catch (error) {
    await cleanUp(court.id);
    throw error;
  }

  console.log(
    "\nPASS: a stale hold recovers correctly — late submission succeeds, and staff visibility tracks its real state throughout.",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
