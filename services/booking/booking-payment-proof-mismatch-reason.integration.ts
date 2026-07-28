/**
 * Item 5 of the payment-path batch: approving a payment whose submitted
 * amount doesn't match the expected total (court hire + coaching, via
 * getExpectedPaymentTotalCents) now requires a non-blank overrideReason,
 * re-derived and re-checked server-side — never trusted from whatever
 * the client claims. A matching payment is unaffected (still one-click
 * approve). The reason itself is readable back afterward via
 * getApprovalOverrideReason, the same audit-log row the approval wrote.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { bookingPaymentProofService } from "./booking-payment-proof.service";

const TEST_DATE = new Date(2031, 5, 12); // Thursday, far enough out not to collide with real usage

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
  await prisma.auditLog.deleteMany({ where: { entityType: "BookingPaymentProof" } });
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
      data: { shiftNumber: `SHIFT-MISMATCH-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  await cleanUp(court.id);

  const approveContext = {
    employeeId: ownerEmployee.id,
    shiftId: shift.id,
    paymentMethodId: gcashMethod.id,
    actorUserId: owner.id,
  };

  // --- Case 1: mismatch, no reason -> rejected, proven failing-first ---
  const slotA = slot(9);
  const holdA = await bookingService.createBookingHold(
    { courtId: court.id, type: "HOURLY", startAt: slotA.startAt, endAt: slotA.endAt, guestName: "Mismatch No-Reason Guest", guestPhone: "09171110006" },
    websiteUser.id,
  );
  const proofA = await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: holdA.id,
    gcashReference: `MISMATCH-NOREASON-${Date.now()}`,
    submittedAmountCents: holdA.totalAmountCents! + 1, // deliberately wrong
    screenshot: { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") },
  });

  console.log("Case 1: approving a mismatched proof with no reason...");
  let rejectedAsExpected = false;
  try {
    await bookingPaymentProofService.approveBookingPaymentProof(proofA.id, approveContext);
  } catch (error) {
    rejectedAsExpected = error instanceof Error && error.message.includes("A reason is required");
    console.log(`  Rejected with: ${error instanceof Error ? error.message : error}`);
  }
  assert(rejectedAsExpected, "expected approveBookingPaymentProof to throw the reason-required error");

  const proofAAfter = await prisma.bookingPaymentProof.findUniqueOrThrow({ where: { id: proofA.id } });
  const bookingAAfter = await prisma.booking.findUniqueOrThrow({ where: { id: holdA.id } });
  assert(proofAAfter.status === "PENDING", `expected proof to stay PENDING, got ${proofAAfter.status}`);
  assert(
    bookingAAfter.status === "PENDING_VERIFICATION",
    `expected booking to stay PENDING_VERIFICATION, got ${bookingAAfter.status}`,
  );
  const salesA = await prisma.sale.findMany({ where: { bookingId: holdA.id } });
  assert(salesA.length === 0, `expected no Sale to be created, got ${salesA.length}`);
  console.log("PASS: a mismatched approval with no reason is rejected, and nothing commits — proven failing-first.");

  // --- Case 2: same mismatch, WITH a reason -> succeeds, reason readable back ---
  console.log("Case 2: approving the SAME mismatched proof, now with a reason...");
  const result2 = await bookingPaymentProofService.approveBookingPaymentProof(proofA.id, {
    ...approveContext,
    overrideReason: "Customer rounded up ₱1 — benign.",
  });
  assert(!result2.alreadyResolved, "expected a real approval, not alreadyResolved");

  const bookingA2 = await prisma.booking.findUniqueOrThrow({ where: { id: holdA.id } });
  assert(bookingA2.status === "CONFIRMED", `expected booking to be CONFIRMED, got ${bookingA2.status}`);

  const reasonBack = await bookingPaymentProofService.getApprovalOverrideReason(proofA.id);
  assert(reasonBack === "Customer rounded up ₱1 — benign.", `expected the reason to round-trip, got ${reasonBack}`);
  console.log(`PASS: approving with a reason succeeds; getApprovalOverrideReason returns: "${reasonBack}"`);

  // --- Case 3: matching amount, no reason -> unaffected, one-click approve still works ---
  const slotB = slot(11);
  const holdB = await bookingService.createBookingHold(
    { courtId: court.id, type: "HOURLY", startAt: slotB.startAt, endAt: slotB.endAt, guestName: "Matching Amount Guest", guestPhone: "09171110007" },
    websiteUser.id,
  );
  const proofB = await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: holdB.id,
    gcashReference: `MATCHING-${Date.now()}`,
    submittedAmountCents: holdB.totalAmountCents!, // exact match
    screenshot: { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") },
  });

  console.log("Case 3: approving a matching proof with no reason (regression guard)...");
  const result3 = await bookingPaymentProofService.approveBookingPaymentProof(proofB.id, approveContext);
  assert(!result3.alreadyResolved, "expected a real approval");
  const bookingB = await prisma.booking.findUniqueOrThrow({ where: { id: holdB.id } });
  assert(bookingB.status === "CONFIRMED", `expected booking to be CONFIRMED, got ${bookingB.status}`);
  console.log("PASS: a matching payment still approves in one click, no reason required.");

  await cleanUp(court.id);
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
