/**
 * Owner request (2026-08-06): "the booking shouldn't push through if no
 * proof of payment is received." actions/public-booking-payment-proof.
 * actions.ts's cancelUnpaidPublicBookingAction is a thin wrapper around
 * getWebsiteBookingContext + bookingService.updateBookingStatus — this
 * proves that exact call sequence (minus only the revalidatePath calls
 * that can't run outside a real request context, same extraction
 * pattern as createPublicBooking's own integration tests) against real
 * rows:
 *
 * 1. A real AWAITING_PAYMENT hold is cancelled and its court/slot is
 *    released, with the booking history and audit log recording it.
 * 2. The safety backstop holds: a booking already past AWAITING_PAYMENT
 *    (e.g. PENDING_VERIFICATION — a screenshot WAS actually received)
 *    is refused, not silently cancelled, however this ever got called
 *    against it.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { getWebsiteBookingContext } from "./website-identity";

const TEST_DATE = new Date(2031, 5, 25); // Wednesday, far enough out not to collide with real usage

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function slot(hour: number): { startAt: Date; endAt: Date } {
  const startAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hour, 0);
  const endAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hour + 1, 0);
  return { startAt, endAt };
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
  const websiteUser = await prisma.user.findFirstOrThrow({ where: { email: "website@thecourtroom.local" } });

  await cleanUp(court.id);

  // --- Case 1: a real AWAITING_PAYMENT hold is cancelled, releasing the
  // slot — the exact scenario a failed screenshot upload now triggers. ---
  const slotA = slot(9);
  const holdA = await bookingService.createBookingHold(
    { courtId: court.id, type: "HOURLY", startAt: slotA.startAt, endAt: slotA.endAt, guestName: "Cancel Unpaid Guest A", guestPhone: "09171110050" },
    websiteUser.id,
  );
  assert(holdA.status === "AWAITING_PAYMENT", `expected a fresh hold, got ${holdA.status}`);

  const availabilityBefore = await bookingService.checkAvailability(court.id, slotA.startAt, slotA.endAt);
  assert(availabilityBefore.available === false, "expected the slot to be held (unavailable) before cancellation");

  const context = await getWebsiteBookingContext();
  const cancelled = await bookingService.updateBookingStatus(
    holdA.id,
    "CANCELLED",
    context.userId,
    "Payment screenshot could not be processed — booking automatically cancelled, slot released.",
  );
  assert(cancelled.status === "CANCELLED", `expected CANCELLED, got ${cancelled.status}`);

  const availabilityAfter = await bookingService.checkAvailability(court.id, slotA.startAt, slotA.endAt);
  assert(availabilityAfter.available === true, "expected the slot to be released back to availability after cancellation");

  const history = await bookingService.getBookingHistory(holdA.id);
  const cancelEntry = history.find((h) => h.status === "CANCELLED");
  assert(cancelEntry !== undefined, "expected a booking history entry recording the cancellation");
  assert(
    cancelEntry!.note === "Payment screenshot could not be processed — booking automatically cancelled, slot released.",
    `expected the real reason recorded, got ${cancelEntry!.note}`,
  );
  console.log("PASS: a real AWAITING_PAYMENT hold with no proof is cancelled, slot released, reason recorded in history.");

  // --- Case 2: safety backstop — a booking already past AWAITING_PAYMENT
  // (a screenshot WAS actually received) is refused, not silently
  // cancelled. ---
  const slotB = slot(11);
  const holdB = await bookingService.createBookingHold(
    { courtId: court.id, type: "HOURLY", startAt: slotB.startAt, endAt: slotB.endAt, guestName: "Cancel Unpaid Guest B", guestPhone: "09171110051" },
    websiteUser.id,
  );
  const { bookingPaymentProofService } = await import("./booking-payment-proof.service");
  await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: holdB.id,
    gcashReference: `CANCELUNPAID-${Date.now()}`,
    submittedAmountCents: holdB.totalAmountCents!,
    screenshot: screenshot(),
  });
  const bookingBAfterProof = await prisma.booking.findUniqueOrThrow({ where: { id: holdB.id } });
  assert(bookingBAfterProof.status === "PENDING_VERIFICATION", `expected PENDING_VERIFICATION, got ${bookingBAfterProof.status}`);

  let refused = false;
  try {
    await bookingService.updateBookingStatus(holdB.id, "CANCELLED", context.userId, "Should be refused.");
  } catch (error) {
    refused = error instanceof Error && error.message.includes("Cannot move a booking");
  }
  assert(refused, "expected cancelling a booking that already has a real proof (PENDING_VERIFICATION) to be refused");

  const bookingBAfterAttempt = await prisma.booking.findUniqueOrThrow({ where: { id: holdB.id } });
  assert(
    bookingBAfterAttempt.status === "PENDING_VERIFICATION",
    `expected the booking to stay PENDING_VERIFICATION, untouched, got ${bookingBAfterAttempt.status}`,
  );
  console.log("PASS: a booking that already received a real payment proof is never touched by this cancellation path — safety backstop holds.");

  await cleanUp(court.id);
  console.log("\nPASS: cancel-unpaid-public-booking proven against real rows.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
