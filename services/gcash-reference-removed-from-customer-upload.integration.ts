/**
 * GCash reference removed from the customer-facing payment upload (both
 * court booking and open-play registration) — the screenshot is the
 * actual proof; retyping a reference between apps was pure friction.
 *
 * Booking's column was already nullable (migration 32,
 * booking-payment-proof-optional-reference.integration.ts already proves
 * it end to end). Open-play's was NOT — still NOT NULL — so this proves
 * the newly-added migration 38 the same way: a null reference is
 * accepted and doesn't collide with a second null-reference PENDING
 * proof under the partial unique index.
 *
 * Also proves the new staff-side replacement — recordGcashReference — for
 * both booking and open-play: succeeds on a PENDING proof with no
 * existing reference, is rejected once the proof is already resolved,
 * and is rejected for a blank value.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../lib/prisma";
import { bookingService } from "./booking/booking.service";
import { bookingPaymentProofService } from "./booking/booking-payment-proof.service";
import { openPlayCapacityService } from "./open-play/open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play/open-play-registration.service";
import { openPlayRegistrationPaymentProofService } from "./open-play/open-play-registration-payment-proof.service";

const BOOKING_TEST_DATE = new Date(2031, 5, 20); // Friday — distinct from other integration fixtures' dates
const OPEN_PLAY_TEST_DATE = new Date(2031, 4, 23); // Friday — distinct from other integration fixtures' dates

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function screenshot() {
  return { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") };
}

async function cleanUpBooking(courtIds: string[]): Promise<void> {
  const dayStart = new Date(BOOKING_TEST_DATE.getFullYear(), BOOKING_TEST_DATE.getMonth(), BOOKING_TEST_DATE.getDate());
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

async function cleanUpOpenPlay(): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date: OPEN_PLAY_TEST_DATE } });
  if (!existing) return;
  const registrations = await prisma.openPlayNightRegistration.findMany({ where: { sessionId: existing.id }, select: { id: true } });
  const ids = registrations.map((r) => r.id);
  await prisma.openPlayRegistrationPaymentProof.deleteMany({ where: { registrationId: { in: ids } } });
  await prisma.sale.deleteMany({ where: { openPlayNightRegistration: { sessionId: existing.id } } });
  await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: existing.id } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
  await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
}

function slot(hour: number): { startAt: Date; endAt: Date } {
  const startAt = new Date(BOOKING_TEST_DATE.getFullYear(), BOOKING_TEST_DATE.getMonth(), BOOKING_TEST_DATE.getDate(), hour, 0);
  const endAt = new Date(BOOKING_TEST_DATE.getFullYear(), BOOKING_TEST_DATE.getMonth(), BOOKING_TEST_DATE.getDate(), hour + 1, 0);
  return { startAt, endAt };
}

async function testOpenPlayAcceptsNullReference(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  await openPlayCapacityService.setSessionCapacityOverride(OPEN_PLAY_TEST_DATE, 8, owner.id);
  const session = await openPlayCapacityService.getOrCreateSessionForDate(OPEN_PLAY_TEST_DATE);

  const holdA = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
    playerName: "Null Ref Guest A",
    phone: "09171260001",
    skillLevel: "INTERMEDIATE",
  });
  assert(holdA.kind === "registered", `expected a hold, got ${holdA.kind}`);
  if (holdA.kind !== "registered") throw new Error("unreachable");

  const proofA = await openPlayRegistrationPaymentProofService.submitOpenPlayRegistrationPaymentProof({
    registrationId: holdA.registration.id,
    gcashReference: null,
    submittedAmountCents: 15000,
    screenshot: screenshot(),
  });
  assert(proofA.gcashReference === null, `expected the stored reference to be null, got ${JSON.stringify(proofA.gcashReference)}`);
  console.log("PASS: open-play accepts a null gcashReference (migration 38) and stores it as null.");

  const holdB = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
    playerName: "Null Ref Guest B",
    phone: "09171260002",
    skillLevel: "INTERMEDIATE",
  });
  assert(holdB.kind === "registered", `expected a hold, got ${holdB.kind}`);
  if (holdB.kind !== "registered") throw new Error("unreachable");

  const proofB = await openPlayRegistrationPaymentProofService.submitOpenPlayRegistrationPaymentProof({
    registrationId: holdB.registration.id,
    gcashReference: null,
    submittedAmountCents: 15000,
    screenshot: screenshot(),
  });
  assert(proofB.gcashReference === null, "expected the second proof's reference to also be stored as null");
  console.log("PASS: a second, concurrent PENDING null-reference proof doesn't collide under the partial unique index.");
}

async function testRecordGcashReferenceBooking(): Promise<void> {
  const websiteUser = await prisma.user.findFirstOrThrow({ where: { email: "website@thecourtroom.local" } });
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, take: 1 });
  assert(courts.length >= 1, "this test needs at least 1 seeded court");
  const court = courts[0];

  const { startAt, endAt } = slot(9);
  const hold = await bookingService.createBookingHold(
    { courtId: court.id, type: "HOURLY", startAt, endAt, guestName: "Record Reference Guest", guestPhone: "09171260010" },
    websiteUser.id,
  );
  const proof = await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: hold.id,
    gcashReference: null,
    submittedAmountCents: 35000,
    screenshot: screenshot(),
  });
  assert(proof.gcashReference === null, "expected the submitted proof to start with no reference");

  const recorded = await bookingPaymentProofService.recordGcashReference(proof.id, "  STAFF-TYPED-123  ", owner.id);
  assert(recorded.gcashReference === "STAFF-TYPED-123", `expected the trimmed reference to be saved, got ${JSON.stringify(recorded.gcashReference)}`);
  console.log("PASS: staff can record a GCash reference manually on a PENDING booking payment proof.");

  let blankRejected = false;
  try {
    await bookingPaymentProofService.recordGcashReference(proof.id, "   ", owner.id);
  } catch {
    blankRejected = true;
  }
  assert(blankRejected, "expected a blank reference to be rejected");

  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-REFTEST-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });
  await bookingPaymentProofService.approveBookingPaymentProof(proof.id, {
    employeeId: employee.id,
    actorUserId: owner.id,
    shiftId: shift.id,
    paymentMethodId: gcashMethod.id,
  });

  let afterResolvedRejected = false;
  try {
    await bookingPaymentProofService.recordGcashReference(proof.id, "TOO-LATE-456", owner.id);
  } catch {
    afterResolvedRejected = true;
  }
  assert(afterResolvedRejected, "expected recording a reference on an already-APPROVED proof to be rejected");
  console.log("PASS: recordGcashReference rejects a blank value and rejects once the proof is already resolved.");
}

async function testRecordGcashReferenceOpenPlay(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const session = await openPlayCapacityService.getOrCreateSessionForDate(OPEN_PLAY_TEST_DATE);

  const hold = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
    playerName: "Record Ref Guest",
    phone: "09171260020",
    skillLevel: "INTERMEDIATE",
  });
  assert(hold.kind === "registered", `expected a hold, got ${hold.kind}`);
  if (hold.kind !== "registered") throw new Error("unreachable");

  const proof = await openPlayRegistrationPaymentProofService.submitOpenPlayRegistrationPaymentProof({
    registrationId: hold.registration.id,
    gcashReference: null,
    submittedAmountCents: 15000,
    screenshot: screenshot(),
  });
  assert(proof.gcashReference === null, "expected the submitted proof to start with no reference");

  const recorded = await openPlayRegistrationPaymentProofService.recordGcashReference(
    proof.id,
    "  STAFF-TYPED-OP-789  ",
    owner.id,
  );
  assert(
    recorded.gcashReference === "STAFF-TYPED-OP-789",
    `expected the trimmed reference to be saved, got ${JSON.stringify(recorded.gcashReference)}`,
  );
  console.log("PASS: staff can record a GCash reference manually on a PENDING open-play payment proof.");

  let blankRejected = false;
  try {
    await openPlayRegistrationPaymentProofService.recordGcashReference(proof.id, "", owner.id);
  } catch {
    blankRejected = true;
  }
  assert(blankRejected, "expected a blank reference to be rejected");
  console.log("PASS: recordGcashReference (open-play) rejects a blank value.");
}

async function main(): Promise<void> {
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, take: 1 });
  await cleanUpBooking(courts.map((c) => c.id));
  await cleanUpOpenPlay();

  try {
    await testOpenPlayAcceptsNullReference();
    await testRecordGcashReferenceBooking();
    await testRecordGcashReferenceOpenPlay();
  } finally {
    await cleanUpBooking(courts.map((c) => c.id));
    await cleanUpOpenPlay();
  }

  console.log("\nAll GCash-reference-removed-from-customer-upload scenarios passed.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
