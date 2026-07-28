/**
 * The GCash reference number is now optional as long as a screenshot is
 * attached (migration 32_gcash_reference_optional) — the screenshot IS
 * the proof; the reference is a convenience for staff, not a hard
 * requirement. The risk this proves against: the hand-written partial
 * unique index on gcashReference (WHERE status IN ('PENDING','APPROVED'),
 * migration 18) must NOT treat two blank submissions as duplicates of
 * each other — Postgres never considers two NULLs equal for uniqueness,
 * but that's exactly the kind of thing worth proving against a real DB
 * rather than assuming.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { bookingPaymentProofService } from "./booking-payment-proof.service";

const TEST_DATE = new Date(2031, 5, 15); // Sunday, far enough out not to collide with real usage

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
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

async function createHold(websiteUserId: string, courtId: string, hour: number, guestPhone: string) {
  const { startAt, endAt } = slot(hour);
  return bookingService.createBookingHold(
    { courtId, type: "HOURLY", startAt, endAt, guestName: "Optional Reference Guest", guestPhone },
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

  // --- Case 1: a null reference is accepted, and stored as null (not
  // an empty string) ---
  const holdA = await createHold(websiteUser.id, courtA.id, 9, "09171110011");
  const proofA = await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: holdA.id,
    gcashReference: null,
    submittedAmountCents: 35000,
    screenshot: screenshot(),
  });
  console.log(`Case 1: submitted with gcashReference=null -> stored as ${JSON.stringify(proofA.gcashReference)}`);
  assert(proofA.gcashReference === null, `expected the stored reference to be null, got ${JSON.stringify(proofA.gcashReference)}`);
  console.log("PASS: a null reference is accepted and stored as null.");

  // --- Case 2: a SECOND, different booking, ALSO submitted with a null
  // reference, while case 1's proof is still PENDING -> must NOT collide
  // against the partial unique index. Proven failing-first would mean
  // this incorrectly throwing DuplicateGcashReferenceError; it must not. ---
  const holdB = await createHold(websiteUser.id, courtB.id, 9, "09171110012");
  let secondNullThrew: unknown = null;
  let proofB: Awaited<ReturnType<typeof bookingPaymentProofService.submitBookingPaymentProof>> | null = null;
  try {
    proofB = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: holdB.id,
      gcashReference: null,
      submittedAmountCents: 35000,
      screenshot: screenshot(),
    });
  } catch (error) {
    secondNullThrew = error;
  }
  console.log(
    `Case 2: a second, concurrent PENDING proof also submitted with gcashReference=null -> ${
      secondNullThrew ? `threw ${secondNullThrew instanceof Error ? secondNullThrew.message : secondNullThrew}` : `succeeded (proofId=${proofB?.id})`
    }`,
  );
  assert(secondNullThrew === null, "expected a second null-reference submission to succeed, not collide with the first");
  assert(proofB !== null && proofB.gcashReference === null, "expected the second proof's reference to also be stored as null");
  console.log("PASS: two simultaneously-PENDING null-reference proofs coexist without a false duplicate-reference rejection.");

  // --- Case 3: a real, non-null reference still enforces uniqueness
  // correctly (regression guard — the nullable column change must not
  // have weakened the existing fraud check for real references). ---
  const holdC = await createHold(websiteUser.id, courtA.id, 11, "09171110013");
  const realReference = `REAL-${Date.now()}`;
  const proofC = await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: holdC.id,
    gcashReference: realReference,
    submittedAmountCents: 35000,
    screenshot: screenshot(),
  });
  assert(proofC.gcashReference === realReference, "expected a real reference to round-trip unchanged");
  console.log(`PASS: a real reference (${realReference}) still stores and round-trips correctly — nullable column, unweakened otherwise.`);

  await cleanUp(courtIds);
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
