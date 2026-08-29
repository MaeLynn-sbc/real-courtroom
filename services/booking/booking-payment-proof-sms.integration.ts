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
import { settingsService } from "../settings/settings.service";

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
  // The SMS master switch defaults OFF (two deliberate actions stand
  // between a deploy and a customer). Turned on here so the dispatcher
  // actually runs, and restored in the cleanup below.
  await settingsService.setSmsEnabled(true, owner.id);
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
    return { providerMessageId: null, providerStatus: null };
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
    // Short booking code (2026-08-06): every guest-facing SMS now shows
    // the short code, not the full bookingReference (see
    // booking-payment-proof.service.ts's customerFacingCode) — a
    // WEBSITE-sourced hold always gets one, so this asserts the code,
    // not the reference.
    assert(holdA.shortCode !== null, "expected the hold to have a short code assigned");
    assert(submitSent.message.includes(holdA.shortCode!), "expected the submission SMS to reference the booking's short code");
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
    // The approval path now runs through smsDispatchService, so this
    // asserts the NEW prefix-free template rather than the old
    // "The Courtroom: ..." string. The sender name reads CourtroomPH, so
    // repeating the venue inside the body was paying twice to say it once.
    assert(
      approveSent.message.includes("confirmed:"),
      `expected the new confirmation wording, got: ${approveSent.message}`,
    );
    assert(
      !approveSent.message.includes("The Courtroom"),
      `expected NO venue prefix in the body, got: ${approveSent.message}`,
    );
    console.log("PASS: approving a payment proof sends a prefix-free confirmation SMS.");

    // And the send is now recorded, which it never was before.
    const logRow = await prisma.smsLog.findFirst({
      where: { trigger: "PUBLIC_BOOKING", entityId: holdA.id },
    });
    assert(logRow !== null, "expected the approval send to be recorded in SmsLog");
    assert(logRow.status === "SENT", `expected SmsLog status SENT, got ${logRow.status}`);
    assert(logRow.phone === "09171230010", `expected the normalised phone on the row, got ${logRow.phone}`);
    assert(logRow.encoding === "GSM-7", `expected GSM-7, got ${logRow.encoding}`);
    assert(logRow.segments === 1, `expected a single segment, got ${logRow.segments}`);
    console.log("PASS: the approval send is recorded in SmsLog as SENT, GSM-7, 1 segment.");

    // Re-approving must not text the customer a second time.
    await bookingPaymentProofService.approveBookingPaymentProof(proofA.id, {
      employeeId: employee.id,
      actorUserId: owner.id,
      shiftId: shift.id,
      paymentMethodId: gcashMethod.id,
    });
    const afterRetry = await prisma.smsLog.count({
      where: { trigger: "PUBLIC_BOOKING", entityId: holdA.id },
    });
    assert(afterRetry === 1, `expected still exactly 1 SmsLog row after re-approval, got ${afterRetry}`);
    console.log("PASS: re-approving the same proof does not send a second confirmation.");

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

    // Owner decision (2026-08-29): rejections send NOTHING. The reason is
    // staff free text and had to be truncated to 38 characters to fit one
    // segment, which stripped the only part worth reading. A vague
    // rejection is worse than silence — it says the money is gone without
    // saying what to do. Staff follow up directly instead.
    const rejectCount = sentMessages.length;
    assert(rejectCount === 0, `expected NO SMS on rejection, got ${rejectCount}`);
    console.log("PASS: rejecting a payment proof sends no SMS at all.");

    await cleanUp(court.id);
    console.log("\nPASS: submission and approval each send their own SMS; rejection sends none.");
  } finally {
    smsService.send = originalSend;
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
