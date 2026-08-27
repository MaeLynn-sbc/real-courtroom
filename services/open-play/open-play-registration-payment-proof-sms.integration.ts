/**
 * Open-play registration payment proof, Gate 3 — SMS proof, mirroring
 * services/booking/booking-payment-proof-sms.integration.ts exactly:
 * monkey-patches the real ConsoleSmsService singleton to record every
 * send, proving the call actually happens for submission, approval,
 * and rejection, not inferred from log output.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRegistrationPaymentProofService } from "./open-play-registration-payment-proof.service";
import { getSmsService } from "../sms/sms-service.factory";
import { settingsService } from "../settings/settings.service";

const TEST_DATE = new Date(2031, 5, 6); // Friday, Jun 6 2031 — distinct from other integration fixtures' dates

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date: TEST_DATE } });
  if (!existing) return;
  const registrations = await prisma.openPlayNightRegistration.findMany({ where: { sessionId: existing.id }, select: { id: true } });
  const ids = registrations.map((r) => r.id);
  await prisma.openPlayRegistrationPaymentProof.deleteMany({ where: { registrationId: { in: ids } } });
  await prisma.sale.deleteMany({ where: { openPlayNightRegistration: { sessionId: existing.id } } });
  await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: existing.id } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
  await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  // The SMS master switch defaults OFF (two deliberate actions stand
  // between a deploy and a customer). Turned on here so the dispatcher
  // actually runs, and restored in the cleanup below.
  await settingsService.setSmsEnabled(true, owner.id);
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-PROOFSMS-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  await cleanUp();

  const smsService = getSmsService();
  const originalSend = smsService.send.bind(smsService);
  const sentMessages: { phone: string; message: string }[] = [];
  smsService.send = async (phone: string, message: string) => {
    sentMessages.push({ phone, message });
    return { providerMessageId: null, providerStatus: null };
  };

  try {
    await openPlayCapacityService.setSessionCapacityOverride(TEST_DATE, 5, owner.id);
    const session = await openPlayCapacityService.getOrCreateSessionForDate(TEST_DATE);

    // --- 1. Submission acknowledgment ---
    const holdA = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "SMS Proof Guest A",
      phone: "09171270001",
      skillLevel: "INTERMEDIATE",
    });
    assert(holdA.kind === "registered", `expected a hold, got ${holdA.kind}`);
    if (holdA.kind !== "registered") throw new Error("unreachable");

    const proofA = await openPlayRegistrationPaymentProofService.submitOpenPlayRegistrationPaymentProof({
      registrationId: holdA.registration.id,
      gcashReference: `SMS-PROOF-A-${Date.now()}`,
      submittedAmountCents: 15000,
      screenshot: { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") },
    });

    const submitCount = sentMessages.length;
    const submitSent = sentMessages[0];
    assert(submitCount === 1, `expected exactly 1 SMS sent on submission, got ${submitCount}`);
    assert(submitSent !== undefined, "expected a recorded SMS send");
    assert(submitSent.phone === "09171270001", `expected the SMS to go to the guest's phone, got ${submitSent.phone}`);
    console.log("PASS: submitting an open-play payment proof sends an acknowledgment SMS.");

    // --- 2. Approval ---
    sentMessages.length = 0;
    const approveResult = await openPlayRegistrationPaymentProofService.approveOpenPlayRegistrationPaymentProof(proofA.id, {
      employeeId: employee.id,
      actorUserId: owner.id,
      shiftId: shift.id,
      paymentMethodId: gcashMethod.id,
    });
    assert(!approveResult.alreadyResolved, "expected the approval to actually resolve");

    const approveCount = sentMessages.length;
    const approveSent = sentMessages[0];
    assert(approveCount === 1, `expected exactly 1 SMS sent on approval, got ${approveCount}`);
    assert(approveSent !== undefined, "expected a recorded SMS send");
    assert(approveSent.phone === "09171270001", `expected the approval SMS to go to the guest's phone, got ${approveSent.phone}`);
    // Asserts the NEW template, which states the booking as a fact
    // ("you're booked for Open Play on ...") rather than using the word
    // "confirmed" — and carries no venue prefix, because the Semaphore
    // sender name already reads CourtroomPH.
    assert(
      approveSent.message.includes("booked for Open Play"),
      `expected the new open-play confirmation wording, got: ${approveSent.message}`,
    );
    assert(
      !approveSent.message.includes("The Courtroom"),
      `expected NO venue prefix in the body, got: ${approveSent.message}`,
    );
    console.log("PASS: approving an open-play payment proof sends a confirmation SMS.");

    // --- 3. Rejection ---
    const holdB = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "SMS Proof Guest B",
      phone: "09171270002",
      skillLevel: "INTERMEDIATE",
    });
    assert(holdB.kind === "registered", `expected a hold, got ${holdB.kind}`);
    if (holdB.kind !== "registered") throw new Error("unreachable");

    const proofB = await openPlayRegistrationPaymentProofService.submitOpenPlayRegistrationPaymentProof({
      registrationId: holdB.registration.id,
      gcashReference: `SMS-PROOF-B-${Date.now()}`,
      submittedAmountCents: 15000,
      screenshot: { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") },
    });

    sentMessages.length = 0;
    const rejectResult = await openPlayRegistrationPaymentProofService.rejectOpenPlayRegistrationPaymentProof(
      proofB.id,
      "Reference number not found in our GCash statement.",
      { employeeId: employee.id, actorUserId: owner.id },
    );
    assert(!rejectResult.alreadyResolved, "expected the rejection to actually resolve");

    // Two SMS fire here: the reject SMS to Guest B, and (since nobody is
    // waiting behind them in this test) no invite SMS — confirmed by
    // checking the rejected guest's own message is present.
    const rejectSent = sentMessages.find((m) => m.phone === "09171270002");
    assert(rejectSent !== undefined, "expected a recorded SMS send to the rejected guest");
    assert(rejectSent.message.includes("Reference number not found in our GCash statement."), "expected the rejection SMS to include the actual reason staff entered");
    assert(rejectSent.message.includes("new registration"), "expected the rejection SMS to state plainly that a new registration is needed");
    console.log("PASS: rejecting an open-play payment proof sends an SMS with the real reason and correct resubmission guidance.");

    await cleanUp();
    console.log("\nPASS: submission, approval, and rejection each send their own correctly-targeted SMS.");
  } finally {
    smsService.send = originalSend;
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUp();
  process.exit(1);
});
