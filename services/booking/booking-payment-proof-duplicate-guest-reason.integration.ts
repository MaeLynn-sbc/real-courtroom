/**
 * Advisory duplicate-guest warning (2026-08-06 incident, Freah): the
 * client double-submit guard + idempotency key stop a duplicate booking
 * being CREATED, but nothing previously warned staff before they
 * APPROVED a second booking for the same guest and an overlapping time
 * slot on a different court — exactly what happened here, approved 58
 * seconds apart by two different staff. approveBookingPaymentProof now
 * re-runs bookingService.findOverlappingBookingForGuest server-side and
 * requires a non-blank duplicateOverrideReason whenever a match exists —
 * never trusted from whatever the client claims. No match (different
 * guest, or the same guest with no overlap) is unaffected: still
 * one-click approve. The reason itself is readable back afterward via
 * getDuplicateOverrideReason, the same audit-log row the approval wrote
 * (mirrors getApprovalOverrideReason exactly).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { bookingPaymentProofService } from "./booking-payment-proof.service";

const TEST_DATE = new Date(2031, 5, 19); // Thursday, far enough out not to collide with real usage

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
  await prisma.sale.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entityType: "BookingPaymentProof" } });
  await prisma.bookingPaymentProof.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
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

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: ownerEmployee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-DUPGUEST-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  await cleanUp(courtIds);

  const approveContext = {
    employeeId: ownerEmployee.id,
    shiftId: shift.id,
    paymentMethodId: gcashMethod.id,
    actorUserId: owner.id,
  };

  // --- Case 1: booking A, same guest phone as nobody yet — approves one
  // click, no reason required, no duplicate exists at this point. ---
  const slotShared = slot(9);
  const holdA = await bookingService.createBookingHold(
    { courtId: courtA.id, type: "HOURLY", startAt: slotShared.startAt, endAt: slotShared.endAt, guestName: "Freah Test Guest", guestPhone: "09171110020" },
    websiteUser.id,
  );
  const proofA = await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: holdA.id,
    gcashReference: `DUPGUEST-A-${Date.now()}`,
    submittedAmountCents: holdA.totalAmountCents!,
    screenshot: screenshot(),
  });
  console.log("Case 1: approving the first booking for this guest — no duplicate exists yet...");
  const result1 = await bookingPaymentProofService.approveBookingPaymentProof(proofA.id, approveContext);
  assert(!result1.alreadyResolved, "expected a real approval");
  const bookingA = await prisma.booking.findUniqueOrThrow({ where: { id: holdA.id } });
  assert(bookingA.status === "CONFIRMED", `expected booking A to be CONFIRMED, got ${bookingA.status}`);
  const dupReasonA = await bookingPaymentProofService.getDuplicateOverrideReason(proofA.id);
  assert(dupReasonA === null, `expected no duplicate reason recorded, got ${dupReasonA}`);
  console.log("PASS: the first booking for a guest approves in one click, no reason required.");

  // --- Case 2: booking B, SAME guest (by phone), overlapping time, a
  // DIFFERENT court — booking A is already CONFIRMED and non-cancelled,
  // so approving B's proof with no reason must be rejected. Proven
  // failing-first: this is the exact real-world shape of the Freah
  // incident (two staff approved 58 seconds apart with no warning). ---
  const holdB = await bookingService.createBookingHold(
    { courtId: courtB.id, type: "HOURLY", startAt: slotShared.startAt, endAt: slotShared.endAt, guestName: "Freah Test Guest", guestPhone: "09171110020" },
    websiteUser.id,
  );
  const proofB = await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: holdB.id,
    gcashReference: `DUPGUEST-B-${Date.now()}`,
    submittedAmountCents: holdB.totalAmountCents!,
    screenshot: screenshot(),
  });

  console.log("Case 2: approving a second, overlapping booking for the SAME guest, no reason...");
  let rejectedAsExpected = false;
  try {
    await bookingPaymentProofService.approveBookingPaymentProof(proofB.id, approveContext);
  } catch (error) {
    rejectedAsExpected =
      error instanceof Error && error.message.includes("already has another booking");
    console.log(`  Rejected with: ${error instanceof Error ? error.message : error}`);
  }
  assert(rejectedAsExpected, "expected approveBookingPaymentProof to throw the duplicate-guest error");

  const proofBAfter = await prisma.bookingPaymentProof.findUniqueOrThrow({ where: { id: proofB.id } });
  const bookingBAfter = await prisma.booking.findUniqueOrThrow({ where: { id: holdB.id } });
  assert(proofBAfter.status === "PENDING", `expected proof B to stay PENDING, got ${proofBAfter.status}`);
  assert(
    bookingBAfter.status === "PENDING_VERIFICATION",
    `expected booking B to stay PENDING_VERIFICATION, got ${bookingBAfter.status}`,
  );
  const salesB = await prisma.sale.findMany({ where: { bookingId: holdB.id } });
  assert(salesB.length === 0, `expected no Sale to be created for booking B, got ${salesB.length}`);
  console.log("PASS: a duplicate-guest approval with no reason is rejected, and nothing commits — proven failing-first.");

  // --- Case 3: same booking B, now WITH a reason -> succeeds, reason
  // readable back via getDuplicateOverrideReason. ---
  console.log("Case 3: approving the SAME booking B, now with a reason...");
  const result3 = await bookingPaymentProofService.approveBookingPaymentProof(proofB.id, {
    ...approveContext,
    duplicateOverrideReason: "Confirmed with customer — two separate courts, two separate GCash payments.",
  });
  assert(!result3.alreadyResolved, "expected a real approval, not alreadyResolved");

  const bookingB2 = await prisma.booking.findUniqueOrThrow({ where: { id: holdB.id } });
  assert(bookingB2.status === "CONFIRMED", `expected booking B to be CONFIRMED, got ${bookingB2.status}`);

  const dupReasonBack = await bookingPaymentProofService.getDuplicateOverrideReason(proofB.id);
  assert(
    dupReasonBack === "Confirmed with customer — two separate courts, two separate GCash payments.",
    `expected the duplicate reason to round-trip, got ${dupReasonBack}`,
  );
  console.log(`PASS: approving with a reason succeeds; getDuplicateOverrideReason returns: "${dupReasonBack}"`);

  // --- Case 4: a DIFFERENT guest, overlapping the same slot on a THIRD
  // — well, reusing courtA at a non-overlapping hour is enough here —
  // must NOT be flagged (regression guard: the check must not fire for
  // just anyone booking the same day). ---
  const slotOther = slot(14);
  const holdC = await bookingService.createBookingHold(
    { courtId: courtA.id, type: "HOURLY", startAt: slotOther.startAt, endAt: slotOther.endAt, guestName: "Completely Different Guest", guestPhone: "09171110099" },
    websiteUser.id,
  );
  const proofC = await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: holdC.id,
    gcashReference: `DUPGUEST-C-${Date.now()}`,
    submittedAmountCents: holdC.totalAmountCents!,
    screenshot: screenshot(),
  });
  console.log("Case 4: approving an unrelated guest's booking, no reason (regression guard)...");
  const result4 = await bookingPaymentProofService.approveBookingPaymentProof(proofC.id, approveContext);
  assert(!result4.alreadyResolved, "expected a real approval");
  const bookingC = await prisma.booking.findUniqueOrThrow({ where: { id: holdC.id } });
  assert(bookingC.status === "CONFIRMED", `expected booking C to be CONFIRMED, got ${bookingC.status}`);
  console.log("PASS: an unrelated guest's booking still approves in one click, no reason required.");

  await cleanUp(courtIds);
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
