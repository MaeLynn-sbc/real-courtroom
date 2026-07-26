/**
 * Gate 2's concurrency requirement: two staff approving the same
 * submission at once must resolve to exactly one outcome — the loser
 * gets a benign no-op (alreadyResolved: true, no second Sale), not an
 * error and not a double-charge. Same §15 pattern 2 shape as settleTab/
 * writeOffTab (status-guarded updateMany IS the guard, no lock needed).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { bookingPaymentProofService } from "./booking-payment-proof.service";

const TEST_DATE = new Date(2031, 5, 11); // Wednesday, far enough out not to collide with real usage

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

async function cleanUp(courtId: string): Promise<void> {
  const dayStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const bookings = await prisma.booking.findMany({
    where: { courtId, startAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  const ids = bookings.map((b) => b.id);
  await prisma.sale.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingPaymentProof.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

async function main(): Promise<void> {
  const websiteUser = await prisma.user.findFirstOrThrow({ where: { email: "website@thecourtroom.local" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: ownerEmployee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-VERIFY-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  await cleanUp(court.id);

  const { startAt, endAt } = slot(9);
  const hold = await bookingService.createBookingHold(
    { courtId: court.id, type: "HOURLY", startAt, endAt, guestName: "Verification Race Guest", guestPhone: "09171110005" },
    websiteUser.id,
  );
  const proof = await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: hold.id,
    gcashReference: `VERIFYRACE-${Date.now()}`,
    screenshot: { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") },
  });

  const approveContext = {
    employeeId: ownerEmployee.id,
    shiftId: shift.id,
    paymentMethodId: gcashMethod.id,
    actorUserId: owner.id,
  };

  console.log("Firing 2 concurrent approveBookingPaymentProof calls against the same PENDING proof...");
  const [resultA, resultB] = await Promise.all([
    bookingPaymentProofService.approveBookingPaymentProof(proof.id, approveContext),
    bookingPaymentProofService.approveBookingPaymentProof(proof.id, approveContext),
  ]);

  const alreadyResolvedFlags = [resultA.alreadyResolved, resultB.alreadyResolved];
  const winners = alreadyResolvedFlags.filter((flag) => !flag).length;
  const losers = alreadyResolvedFlags.filter((flag) => flag).length;
  console.log(`  Winners (alreadyResolved=false): ${winners}, losers (alreadyResolved=true, benign no-op): ${losers}`);
  assert(winners === 1, `expected exactly 1 winner, got ${winners}`);
  assert(losers === 1, `expected exactly 1 loser (benign no-op), got ${losers}`);

  const salesForBooking = await prisma.sale.findMany({ where: { bookingId: hold.id } });
  console.log(`  Sale rows created for this booking: ${salesForBooking.length}`);
  assert(salesForBooking.length === 1, `expected exactly 1 Sale, got ${salesForBooking.length}`);

  const bookingAfter = await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } });
  console.log(`  Booking.status after both concurrent approvals: ${bookingAfter.status}`);
  assert(bookingAfter.status === "CONFIRMED", `expected booking to be CONFIRMED exactly once, got ${bookingAfter.status}`);

  console.log("PASS: two concurrent approvals of the same proof resolve to exactly one winner, one benign no-op, and exactly one Sale.");

  await cleanUp(court.id);
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
