/**
 * Phase 8 Gate 2's load-bearing proof, same shape as coaching's Gate 3
 * (services/coaching/public-coach-session-forbidden-values.integration.ts):
 * the public payment-proof submission path hardcodes its own privilege
 * server-side. This test SENDS the forbidden values — it does not omit
 * them — and asserts the server ignores every one of them, storing the
 * hardcoded values instead. Calls bookingPaymentProofService directly,
 * bypassing actions/public-booking-payment-proof.actions.ts's zod schema
 * entirely (that schema would already strip these fields — the point
 * here is proving the SERVICE itself refuses them too, not relying on
 * the schema layer alone).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { bookingPaymentProofService } from "./booking-payment-proof.service";

const TEST_DATE = new Date(2031, 5, 9); // Monday, far enough out not to collide with real usage

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
  await prisma.bookingPaymentProof.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.sale.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

async function main(): Promise<void> {
  const websiteUser = await prisma.user.findFirstOrThrow({ where: { email: "website@thecourtroom.local" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const fakeEmployee = await prisma.employee.findFirstOrThrow({});

  await cleanUp(court.id);

  const { startAt, endAt } = slot(9);
  const hold = await bookingService.createBookingHold(
    { courtId: court.id, type: "HOURLY", startAt, endAt, guestName: "Forbidden Value Guest", guestPhone: "09171110001" },
    websiteUser.id,
  );
  assert(hold.status === "AWAITING_PAYMENT", `expected a fresh hold to be AWAITING_PAYMENT, got ${hold.status}`);

  const forbiddenReference = `FORBIDDEN-${Date.now()}`;
  console.log(
    `SENT: { status: 'APPROVED', resolvedByEmployeeId: '${fakeEmployee.id}', resolvedAt: <now>, rejectionReason: 'nope' } alongside a real submission.`,
  );

  const proof = await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: hold.id,
    gcashReference: forbiddenReference,
    screenshot: { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") },
    // Forbidden values, sent on purpose — a crafted request could send
    // exactly this. The type allows it (see SubmitBookingPaymentProofInput's
    // own comment); the method must not read any of it below.
    status: "APPROVED",
    resolvedByEmployeeId: fakeEmployee.id,
    resolvedAt: new Date(),
    rejectionReason: "nope",
  });

  console.log(`RESULT: proof.status=${proof.status}, resolvedByEmployeeId=${proof.resolvedByEmployeeId}, resolvedAt=${proof.resolvedAt}, rejectionReason=${proof.rejectionReason}`);
  assert(proof.status === "PENDING", `expected status PENDING (sent 'APPROVED'), got ${proof.status}`);
  assert(proof.resolvedByEmployeeId === null, `expected resolvedByEmployeeId null (sent a real employee id), got ${proof.resolvedByEmployeeId}`);
  assert(proof.resolvedAt === null, `expected resolvedAt null (sent a real Date), got ${proof.resolvedAt}`);
  assert(proof.rejectionReason === null, `expected rejectionReason null (sent 'nope'), got ${proof.rejectionReason}`);
  console.log("VERIFIED: stored row is PENDING with all resolution fields null — every forbidden value was ignored.");

  const bookingAfter = await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } });
  console.log(`Booking.status after submission: ${bookingAfter.status}, holdExpiresAt: ${bookingAfter.holdExpiresAt}`);
  assert(bookingAfter.status === "PENDING_VERIFICATION", `expected booking to move to PENDING_VERIFICATION, got ${bookingAfter.status}`);
  assert(bookingAfter.holdExpiresAt === null, `expected holdExpiresAt to be cleared at submission, got ${bookingAfter.holdExpiresAt}`);

  await cleanUp(court.id);
  console.log(
    "PASS: the public payment-proof submission hardcodes status=PENDING and ignores every resolution field, proven by SENDING all four forbidden values, not omitting them.",
  );
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
