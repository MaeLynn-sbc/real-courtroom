/**
 * Open-play registration payment proof — Gate 3. Mirrors
 * services/booking/booking-payment-proof.service.ts's own integration
 * test shape exactly: submission moves the registration to
 * PENDING_VERIFICATION and creates a PENDING proof; approval creates a
 * real Sale (via the SAME createOpenPlayRegistrationFeeSale mechanism
 * the Fri/Sat walk-in fee already uses) and confirms the registration;
 * rejection releases the seat and invites the next waiter, same as any
 * other release path.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRegistrationPaymentProofService } from "./open-play-registration-payment-proof.service";

const TEST_DATE = new Date(2031, 4, 16); // Friday, May 16 2031 — distinct from other integration fixtures' dates

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
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-PROOF-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  await cleanUp();

  try {
    await openPlayCapacityService.setSessionCapacityOverride(TEST_DATE, 3, owner.id);
    const session = await openPlayCapacityService.getOrCreateSessionForDate(TEST_DATE);

    // ============== APPROVE path ==============
    const holdA = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "Proof Guest A",
      phone: "09171240001",
      skillLevel: "INTERMEDIATE",
    });
    assert(holdA.kind === "registered", `expected a hold, got ${holdA.kind}`);
    if (holdA.kind !== "registered") throw new Error("unreachable");

    const proofA = await openPlayRegistrationPaymentProofService.submitOpenPlayRegistrationPaymentProof({
      registrationId: holdA.registration.id,
      gcashReference: `PROOF-A-${Date.now()}`,
      submittedAmountCents: 15000,
      screenshot: { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") },
    });
    assert(proofA.status === "PENDING", `expected proof PENDING, got ${proofA.status}`);

    const regAfterSubmit = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: holdA.registration.id } });
    assert(regAfterSubmit.status === "PENDING_VERIFICATION", `expected PENDING_VERIFICATION, got ${regAfterSubmit.status}`);
    assert(regAfterSubmit.holdExpiresAt === null, "expected holdExpiresAt cleared at submission");
    console.log("PASS: submitting proof moves the registration to PENDING_VERIFICATION and clears the hold.");

    const approveResult = await openPlayRegistrationPaymentProofService.approveOpenPlayRegistrationPaymentProof(proofA.id, {
      employeeId: employee.id,
      actorUserId: owner.id,
      shiftId: shift.id,
      paymentMethodId: gcashMethod.id,
    });
    assert(!approveResult.alreadyResolved, "expected the approval to actually resolve");

    const regAfterApprove = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: holdA.registration.id } });
    assert(regAfterApprove.status === "CONFIRMED", `expected CONFIRMED, got ${regAfterApprove.status}`);

    const sale = await prisma.sale.findUnique({ where: { openPlayNightRegistrationId: holdA.registration.id } });
    assert(sale, "expected approval to create a real Sale via the shared registration-fee mechanism");
    assert(sale!.amountCents === 15000, `expected amountCents 15000, got ${sale!.amountCents}`);
    assert(sale!.paymentMethodId === gcashMethod.id, "expected the Sale attributed to the GCash payment method");
    console.log("PASS: approving a proof confirms the registration and creates the same Sale walk-ins get.");

    // ============== REJECT path, with a waiter behind it ==============
    const holdB = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "Proof Guest B",
      phone: "09171240002",
      skillLevel: "INTERMEDIATE",
    });
    assert(holdB.kind === "registered", `expected a hold, got ${holdB.kind}`);
    if (holdB.kind !== "registered") throw new Error("unreachable");

    // Fill the last seat (capacity 3, one already CONFIRMED from A) so a
    // third submission waitlists — this is who should get invited when B
    // is rejected.
    const holdC = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "Proof Guest C",
      phone: "09171240003",
      skillLevel: "INTERMEDIATE",
    });
    assert(holdC.kind === "registered", `expected a hold (3rd seat), got ${holdC.kind}`);

    const waiter = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "Proof Waiter",
      phone: "09171240004",
      skillLevel: "INTERMEDIATE",
    });
    assert(waiter.kind === "waitlisted", `expected the 4th submission waitlisted (full), got ${waiter.kind}`);
    if (waiter.kind !== "waitlisted") throw new Error("unreachable");

    const proofB = await openPlayRegistrationPaymentProofService.submitOpenPlayRegistrationPaymentProof({
      registrationId: holdB.registration.id,
      gcashReference: `PROOF-B-${Date.now()}`,
      submittedAmountCents: 15000,
      screenshot: { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") },
    });

    const rejectResult = await openPlayRegistrationPaymentProofService.rejectOpenPlayRegistrationPaymentProof(
      proofB.id,
      "Screenshot doesn't match the reference number.",
      { employeeId: employee.id, actorUserId: owner.id },
    );
    assert(!rejectResult.alreadyResolved, "expected the rejection to actually resolve");

    const regAfterReject = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: holdB.registration.id } });
    assert(regAfterReject.status === "REJECTED", `expected REJECTED, got ${regAfterReject.status}`);
    const noSaleForRejected = await prisma.sale.findUnique({ where: { openPlayNightRegistrationId: holdB.registration.id } });
    assert(noSaleForRejected === null, "expected NO Sale for a rejected registration");

    const waiterEntry = await prisma.openPlayWaitlistEntry.findUniqueOrThrow({ where: { id: waiter.entry.id } });
    assert(waiterEntry.status === "INVITED", `expected the waiter invited after B's rejection freed a seat, got ${waiterEntry.status}`);
    console.log("PASS: rejecting a proof releases the registration (REJECTED, no Sale) and invites the next waiter, same as any other release.");

    await cleanUp();
    console.log("\nPASS: open-play payment proof lifecycle proven against real rows.");
  } finally {
    // no switches touched by this file — submitOnlineRegistration was
    // called directly, same convention as open-play-capacity-upcoming-
    // counts.integration.ts.
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUp();
  process.exit(1);
});
