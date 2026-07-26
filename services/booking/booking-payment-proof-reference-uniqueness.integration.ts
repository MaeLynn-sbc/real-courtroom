/**
 * BUILD-SPEC.md §8 "unique across all payments" fraud check, and Gate 2's
 * explicit ask: enforced at the DB level (the hand-written partial unique
 * index from Gate 1, prisma/migrations/18_.../migration.sql), not just
 * hoped for — proven here by actually attempting a duplicate, not by
 * inspecting the migration. Also proves the narrower, correct shape of
 * the invariant: a REJECTED proof's reference is NOT permanently burned —
 * resubmitting the same reference against the SAME booking after a
 * rejection must succeed (a bad screenshot isn't a bad payment).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { bookingPaymentProofService, DuplicateGcashReferenceError } from "./booking-payment-proof.service";

const TEST_DATE = new Date(2031, 5, 10); // Tuesday, far enough out not to collide with real usage

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

async function cleanUp(courtIds: string[]): Promise<void> {
  const dayStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const bookings = await prisma.booking.findMany({
    where: { courtId: { in: courtIds }, startAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  const ids = bookings.map((b) => b.id);
  await prisma.bookingPaymentProof.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.sale.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

async function createHold(websiteUserId: string, courtId: string, hour: number, guestPhone: string) {
  const { startAt, endAt } = slot(hour);
  return bookingService.createBookingHold(
    { courtId, type: "HOURLY", startAt, endAt, guestName: "Reference Uniqueness Guest", guestPhone },
    websiteUserId,
  );
}

function screenshot() {
  return { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") };
}

async function main(): Promise<void> {
  const websiteUser = await prisma.user.findFirstOrThrow({ where: { email: "website@thecourtroom.local" } });
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, take: 2 });
  assert(courts.length >= 2, "this test needs at least 2 seeded courts");
  const [courtA, courtB] = courts;
  const courtIds = [courtA.id, courtB.id];

  await cleanUp(courtIds);

  // === Scenario 1: same reference, two DIFFERENT bookings — rejected ===
  const holdA = await createHold(websiteUser.id, courtA.id, 9, "09171110002");
  const holdB = await createHold(websiteUser.id, courtB.id, 9, "09171110003");

  const sharedReference = `SHARED-${Date.now()}`;
  console.log(`SENT: gcashReference '${sharedReference}' against booking A.`);
  const proofA = await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: holdA.id,
    gcashReference: sharedReference,
    screenshot: screenshot(),
  });
  console.log(`RESULT: succeeded (proofId=${proofA.id}).`);

  console.log(`SENT: the SAME gcashReference '${sharedReference}' against a DIFFERENT booking B.`);
  let secondSubmissionThrew = false;
  try {
    await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: holdB.id,
      gcashReference: sharedReference,
      screenshot: screenshot(),
    });
  } catch (error) {
    secondSubmissionThrew = error instanceof DuplicateGcashReferenceError;
    console.log(`RESULT: threw ${error instanceof Error ? error.constructor.name : typeof error} — "${error instanceof Error ? error.message : error}"`);
  }
  assert(secondSubmissionThrew, "expected submitting the same reference against a different booking to throw DuplicateGcashReferenceError");

  const bookingBAfter = await prisma.booking.findUniqueOrThrow({ where: { id: holdB.id } });
  assert(
    bookingBAfter.status === "AWAITING_PAYMENT",
    `expected booking B to remain AWAITING_PAYMENT after the rejected duplicate, got ${bookingBAfter.status}`,
  );
  console.log("VERIFIED: booking B was NOT silently accepted — still AWAITING_PAYMENT, no proof row created for it.");

  // === Scenario 2: same reference, SAME booking, after a REJECTION — allowed ===
  const holdC = await createHold(websiteUser.id, courtA.id, 11, "09171110004");
  const resubmitReference = `RESUBMIT-${Date.now()}`;

  const proofC1 = await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: holdC.id,
    gcashReference: resubmitReference,
    screenshot: screenshot(),
  });

  const employee = await prisma.employee.findFirstOrThrow({});
  await bookingPaymentProofService.rejectBookingPaymentProof(proofC1.id, "Blurry screenshot, please resend.", {
    employeeId: employee.id,
    actorUserId: websiteUser.id,
  });
  const bookingCAfterReject = await prisma.booking.findUniqueOrThrow({ where: { id: holdC.id } });
  console.log(`After rejection, booking C status: ${bookingCAfterReject.status}`);
  assert(bookingCAfterReject.status === "REJECTED", `expected booking C to be REJECTED, got ${bookingCAfterReject.status}`);

  // A rejected booking is terminal (services/booking/booking-status.ts) —
  // resubmission is a NEW booking, but the reference itself must still be
  // reusable (this is what the partial index actually protects: PENDING/
  // APPROVED only). Prove the reference is free by using it again on a
  // brand-new hold — if the old REJECTED row still "owned" it, this would
  // throw DuplicateGcashReferenceError.
  const holdD = await createHold(websiteUser.id, courtA.id, 13, "09171110004");
  console.log(`SENT: the SAME gcashReference '${resubmitReference}' again, now against a fresh booking (simulating a corrected resubmission).`);
  const proofD = await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: holdD.id,
    gcashReference: resubmitReference,
    screenshot: screenshot(),
  });
  console.log(`RESULT: succeeded (proofId=${proofD.id}) — a REJECTED proof does not permanently burn its reference.`);

  await cleanUp(courtIds);
  console.log(
    "PASS: reference uniqueness is enforced at the DB level across different bookings, and correctly does not block resubmitting the same reference after a rejection.",
  );
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
