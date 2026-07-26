/**
 * Payment-proof verification-outcome SMS, added alongside open-play
 * Gate 3. Proves the actual call happens (monkey-patching the real
 * ConsoleSmsService singleton, same technique as open-play's own
 * open-play-waitlist-invite-sms.integration.ts) for all three moments
 * in a booking's payment-proof lifecycle: submission acknowledgment,
 * approval, and rejection. Coaching rides on the same Booking/
 * BookingPaymentProof (confirmed: CoachSession has no independent
 * payment-proof concept) — nothing extra needed there, this same SMS
 * covers a booking with an attached coach session too.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { bookingPaymentProofService } from "./booking-payment-proof.service";
import { getSmsService } from "../sms/sms-service.factory";

const TEST_DATE = new Date(2031, 5, 16); // Monday, distinct from other booking-proof fixture dates

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
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-SMS-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  await cleanUp(court.id);

  const smsService = getSmsService();
  const originalSend = smsService.send.bind(smsService);
  const sentMessages: { phone: string; message: string }[] = [];
  smsService.send = async (phone: string, message: string) => {
    sentMessages.push({ phone, message });
  };

  try {
    // --- 1. Submission acknowledgment ---
    const holdA = await bookingService.createBookingHold(
      { courtId: court.id, type: "HOURLY", startAt: slot(9).startAt, endAt: slot(9).endAt, guestName: "SMS Guest A", guestPhone: "09171230010" },
      websiteUser.id,
    );
    assert(holdA.status === "AWAITING_PAYMENT", `expected a fresh hold, got ${holdA.status}`);

    const proofA = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: holdA.id,
      gcashReference: `SMS-TEST-A-${Date.now()}`,
      submittedAmountCents: holdA.totalAmountCents ?? 35000,
      screenshot: { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") },
    });

    const submitCount = sentMessages.length;
    const submitSent = sentMessages[0];
    assert(submitCount === 1, `expected exactly 1 SMS sent on submission, got ${submitCount}`);
    assert(submitSent !== undefined, "expected a recorded SMS send");
    assert(submitSent.phone === "09171230010", `expected the SMS to go to the guest's phone, got ${submitSent.phone}`);
    assert(submitSent.message.includes(holdA.bookingReference), "expected the submission SMS to reference the booking");
    console.log("PASS: submitting payment proof sends an acknowledgment SMS before staff ever look at it.");

    // --- 2. Approval ---
    sentMessages.length = 0;
    const approveResult = await bookingPaymentProofService.approveBookingPaymentProof(proofA.id, {
      employeeId: employee.id,
      actorUserId: owner.id,
      shiftId: shift.id,
      paymentMethodId: gcashMethod.id,
    });
    assert(!approveResult.alreadyResolved, "expected the approval to actually resolve the proof");

    const approveCount = sentMessages.length;
    const approveSent = sentMessages[0];
    assert(approveCount === 1, `expected exactly 1 SMS sent on approval, got ${approveCount}`);
    assert(approveSent !== undefined, "expected a recorded SMS send");
    assert(approveSent.phone === "09171230010", `expected the approval SMS to go to the guest's phone, got ${approveSent.phone}`);
    assert(approveSent.message.includes("CONFIRMED"), "expected the approval SMS to say CONFIRMED");
    console.log("PASS: approving a payment proof sends a CONFIRMED SMS.");

    // --- 3. Rejection ---
    const holdB = await bookingService.createBookingHold(
      { courtId: court.id, type: "HOURLY", startAt: slot(11).startAt, endAt: slot(11).endAt, guestName: "SMS Guest B", guestPhone: "09171230011" },
      websiteUser.id,
    );
    const proofB = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: holdB.id,
      gcashReference: `SMS-TEST-B-${Date.now()}`,
      submittedAmountCents: holdB.totalAmountCents ?? 35000,
      screenshot: { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") },
    });

    sentMessages.length = 0;
    const rejectResult = await bookingPaymentProofService.rejectBookingPaymentProof(
      proofB.id,
      "Amount doesn't match the booking total.",
      { employeeId: employee.id, actorUserId: owner.id },
    );
    assert(!rejectResult.alreadyResolved, "expected the rejection to actually resolve the proof");

    const rejectCount = sentMessages.length;
    const rejectSent = sentMessages[0];
    assert(rejectCount === 1, `expected exactly 1 SMS sent on rejection, got ${rejectCount}`);
    assert(rejectSent !== undefined, "expected a recorded SMS send");
    assert(rejectSent.phone === "09171230011", `expected the rejection SMS to go to the guest's phone, got ${rejectSent.phone}`);
    assert(rejectSent.message.includes("Amount doesn't match the booking total."), "expected the rejection SMS to include the actual reason staff entered");
    assert(rejectSent.message.includes("new booking"), "expected the rejection SMS to state plainly that a new booking is needed, not a resubmit step that doesn't exist");
    console.log("PASS: rejecting a payment proof sends an SMS with the real reason and correct resubmission guidance.");

    await cleanUp(court.id);
    console.log("\nPASS: submission, approval, and rejection each send their own correctly-targeted SMS.");
  } finally {
    smsService.send = originalSend;
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
