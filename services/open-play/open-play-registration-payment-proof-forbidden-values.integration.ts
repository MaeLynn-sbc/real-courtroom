/**
 * Open-play registration payment proof, Gate 3 — same load-bearing
 * proof as booking-payment-proof-forbidden-values.integration.ts: the
 * public submission path hardcodes its own privilege server-side. This
 * test SENDS forbidden resolution values (not omits them) and asserts
 * the service ignores every one, storing the hardcoded PENDING status
 * with every resolution field null.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRegistrationPaymentProofService } from "./open-play-registration-payment-proof.service";

const TEST_DATE = new Date(2031, 4, 23); // Friday, May 23 2031 — distinct from other integration fixtures' dates

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
  await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
  await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const fakeEmployee = await prisma.employee.findFirstOrThrow({});

  await cleanUp();

  try {
    await openPlayCapacityService.setSessionCapacityOverride(TEST_DATE, 5, owner.id);
    const session = await openPlayCapacityService.getOrCreateSessionForDate(TEST_DATE);

    const hold = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "Forbidden Proof Guest",
      phone: "09171250001",
      skillLevel: "INTERMEDIATE",
    });
    assert(hold.kind === "registered", `expected a hold, got ${hold.kind}`);
    if (hold.kind !== "registered") throw new Error("unreachable");

    console.log(
      `SENT: { status: 'APPROVED', resolvedByEmployeeId: '${fakeEmployee.id}', resolvedAt: <now>, rejectionReason: 'nope' } alongside a real submission.`,
    );

    const proof = await openPlayRegistrationPaymentProofService.submitOpenPlayRegistrationPaymentProof({
      registrationId: hold.registration.id,
      gcashReference: `FORBIDDEN-${Date.now()}`,
      submittedAmountCents: 15000,
      screenshot: { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") },
      status: "APPROVED",
      resolvedByEmployeeId: fakeEmployee.id,
      resolvedAt: new Date(),
      rejectionReason: "nope",
    });

    console.log(`RESULT: proof.status=${proof.status}, resolvedByEmployeeId=${proof.resolvedByEmployeeId}, resolvedAt=${proof.resolvedAt}, rejectionReason=${proof.rejectionReason}`);
    assert(proof.status === "PENDING", `expected status PENDING (sent 'APPROVED'), got ${proof.status}`);
    assert(proof.resolvedByEmployeeId === null, `expected resolvedByEmployeeId null, got ${proof.resolvedByEmployeeId}`);
    assert(proof.resolvedAt === null, `expected resolvedAt null, got ${proof.resolvedAt}`);
    assert(proof.rejectionReason === null, `expected rejectionReason null, got ${proof.rejectionReason}`);
    console.log("VERIFIED: stored row is PENDING with all resolution fields null — every forbidden value was ignored.");

    const regAfter = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: hold.registration.id } });
    assert(regAfter.status === "PENDING_VERIFICATION", `expected PENDING_VERIFICATION, got ${regAfter.status}`);
    assert(regAfter.holdExpiresAt === null, "expected holdExpiresAt cleared at submission");

    await cleanUp();
    console.log(
      "PASS: open-play payment-proof submission hardcodes status=PENDING and ignores every resolution field, proven by SENDING all four forbidden values, not omitting them.",
    );
  } finally {
    // no switches touched — submitOnlineRegistration called directly.
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUp();
  process.exit(1);
});
