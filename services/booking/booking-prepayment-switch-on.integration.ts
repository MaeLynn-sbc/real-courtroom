/**
 * Full lifecycle with the prepayment switch ON (test-only — the switch
 * is turned back off in this file's own cleanup, regardless of outcome,
 * so it never leaks into any other test or the real running app).
 *
 * Forward path: submit -> hold has no expiry after submission -> staff
 * verifies -> booking confirms.
 * Reverse path: staff rejects -> booking shows why -> slot frees.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { bookingPaymentProofService } from "./booking-payment-proof.service";
import { createPublicBooking } from "./public-booking.service";
import { settingsService } from "../settings/settings.service";

const TEST_DATE = new Date(2031, 5, 13); // Friday, far enough out not to collide with real usage

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
  await prisma.sale.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingPaymentProof.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

async function main(): Promise<void> {
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: ownerEmployee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-SWITCHON-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  await cleanUp(court.id);

  try {
    await settingsService.setBookingRequirePrepayment(true, owner.id);
    const switchState = await settingsService.getBookingRequirePrepayment();
    assert(switchState === true, "expected the switch to read true after turning it on");
    console.log("Switch turned ON for this test.");

    // ============== FORWARD PATH: submit -> approve -> confirmed ==============
    const forwardSlot = slot(9);
    const forwardResult = await createPublicBooking({
      courtId: court.id,
      startAt: forwardSlot.startAt,
      endAt: forwardSlot.endAt,
      guestName: "Switch On Forward Guest",
      guestPhone: "09171110007",
    });
    console.log(`Created hold: requiresPayment=${forwardResult.requiresPayment}, holdExpiresAt=${forwardResult.holdExpiresAt}`);
    assert(forwardResult.requiresPayment === true, "expected requiresPayment=true with the switch on");
    assert(forwardResult.holdExpiresAt instanceof Date, "expected a real holdExpiresAt on the hold");

    const holdBooking = await prisma.booking.findUniqueOrThrow({ where: { id: forwardResult.bookingId } });
    assert(holdBooking.status === "AWAITING_PAYMENT", `expected AWAITING_PAYMENT, got ${holdBooking.status}`);
    const saleAtHoldTime = await prisma.sale.findUnique({ where: { bookingId: holdBooking.id } });
    assert(saleAtHoldTime === null, "expected NO Sale at hold creation — nothing has been paid yet");
    console.log("Hold created: AWAITING_PAYMENT, no Sale yet — correct.");

    const forwardProof = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: holdBooking.id,
      gcashReference: `SWITCHON-FWD-${Date.now()}`,
      submittedAmountCents: holdBooking.totalAmountCents ?? 35000,
      screenshot: screenshot(),
    });
    const bookingAfterSubmit = await prisma.booking.findUniqueOrThrow({ where: { id: holdBooking.id } });
    console.log(`After submission: status=${bookingAfterSubmit.status}, holdExpiresAt=${bookingAfterSubmit.holdExpiresAt}`);
    assert(bookingAfterSubmit.status === "PENDING_VERIFICATION", `expected PENDING_VERIFICATION, got ${bookingAfterSubmit.status}`);
    assert(bookingAfterSubmit.holdExpiresAt === null, "expected holdExpiresAt cleared — hold has no expiry after submission");

    const approveResult = await bookingPaymentProofService.approveBookingPaymentProof(forwardProof.id, {
      employeeId: ownerEmployee.id,
      shiftId: shift.id,
      paymentMethodId: gcashMethod.id,
      actorUserId: owner.id,
    });
    assert(approveResult.alreadyResolved === false, "expected the approval to be the real, first resolution");

    const bookingAfterApprove = await prisma.booking.findUniqueOrThrow({ where: { id: holdBooking.id } });
    const saleAfterApprove = await prisma.sale.findUnique({ where: { bookingId: holdBooking.id } });
    console.log(`After approval: status=${bookingAfterApprove.status}, Sale created=${saleAfterApprove !== null}, Sale paymentMethod=GCash`);
    assert(bookingAfterApprove.status === "CONFIRMED", `expected CONFIRMED, got ${bookingAfterApprove.status}`);
    assert(saleAfterApprove !== null, "expected a Sale to be created on approval");
    assert(saleAfterApprove.paymentMethodId === gcashMethod.id, "expected the Sale's payment method to be GCash");
    assert(saleAfterApprove.employeeId === ownerEmployee.id, "expected the Sale attributed to the approving employee");
    console.log("PASS (forward path): submit -> no-expiry pending -> staff verifies -> booking confirms, Sale created.");

    // ============== REVERSE PATH: submit -> reject -> slot frees ==============
    const reverseSlot = slot(13);
    const reverseResult = await createPublicBooking({
      courtId: court.id,
      startAt: reverseSlot.startAt,
      endAt: reverseSlot.endAt,
      guestName: "Switch On Reverse Guest",
      guestPhone: "09171110008",
    });
    const reverseBooking = await prisma.booking.findUniqueOrThrow({ where: { id: reverseResult.bookingId } });

    const availabilityDuringHold = await bookingService.checkAvailability(court.id, reverseSlot.startAt, reverseSlot.endAt);
    assert(availabilityDuringHold.available === false, "expected the slot to be unavailable while the hold is live");

    const reverseProof = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: reverseBooking.id,
      gcashReference: `SWITCHON-REV-${Date.now()}`,
      submittedAmountCents: reverseBooking.totalAmountCents ?? 35000,
      screenshot: screenshot(),
    });

    const rejectResult = await bookingPaymentProofService.rejectBookingPaymentProof(
      reverseProof.id,
      "Screenshot doesn't show a completed transaction.",
      { employeeId: ownerEmployee.id, actorUserId: owner.id },
    );
    assert(rejectResult.alreadyResolved === false, "expected the rejection to be the real, first resolution");

    const bookingAfterReject = await prisma.booking.findUniqueOrThrow({ where: { id: reverseBooking.id } });
    const proofAfterReject = await prisma.bookingPaymentProof.findUniqueOrThrow({ where: { id: reverseProof.id } });
    console.log(
      `After rejection: booking.status=${bookingAfterReject.status}, proof.status=${proofAfterReject.status}, reason="${proofAfterReject.rejectionReason}"`,
    );
    assert(bookingAfterReject.status === "REJECTED", `expected REJECTED, got ${bookingAfterReject.status}`);
    assert(proofAfterReject.status === "REJECTED", `expected proof REJECTED, got ${proofAfterReject.status}`);
    assert(
      proofAfterReject.rejectionReason === "Screenshot doesn't show a completed transaction.",
      "expected the rejection reason to be stored — this is what the customer sees why",
    );
    const saleAfterReject = await prisma.sale.findUnique({ where: { bookingId: reverseBooking.id } });
    assert(saleAfterReject === null, "expected NO Sale for a rejected booking — no valid payment ever existed");

    const availabilityAfterReject = await bookingService.checkAvailability(court.id, reverseSlot.startAt, reverseSlot.endAt);
    console.log(`Slot available after rejection: ${availabilityAfterReject.available}`);
    assert(availabilityAfterReject.available === true, "expected the slot to be free again after rejection — a new booking should be possible");

    console.log("PASS (reverse path): staff rejects -> booking shows why (rejectionReason stored) -> slot frees, no Sale.");

    await cleanUp(court.id);
    console.log("\nPASS: full switch-on lifecycle proven — forward (confirm) and reverse (reject/release) both correct.");
  } finally {
    // Always restore the real default, regardless of outcome — this is
    // shared, persistent state (a Setting row), not test-local data.
    await settingsService.setBookingRequirePrepayment(false, owner.id);
    const restored = await settingsService.getBookingRequirePrepayment();
    console.log(`Switch restored to OFF (verified: ${restored === false}).`);
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
