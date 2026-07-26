/**
 * Open-play registration payment proof, Gate 3 — concurrency, same §15
 * pattern 2 (a status-guarded updateMany as the guard itself) every
 * other proof-resolution path in this app already uses. Two staff
 * approving the same PENDING proof at once must resolve to exactly one
 * real approval (one Sale, one CONFIRMED) and one benign no-op — never
 * two Sales, never a raw DB error.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRegistrationPaymentProofService } from "./open-play-registration-payment-proof.service";

const TEST_DATE = new Date(2031, 4, 30); // Friday, May 30 2031 — distinct from other integration fixtures' dates

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
  await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
  await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-PROOFRACE-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  await cleanUp();

  try {
    await openPlayCapacityService.setSessionCapacityOverride(TEST_DATE, 5, owner.id);
    const session = await openPlayCapacityService.getOrCreateSessionForDate(TEST_DATE);

    const hold = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "Race Proof Guest",
      phone: "09171260001",
      skillLevel: "INTERMEDIATE",
    });
    assert(hold.kind === "registered", `expected a hold, got ${hold.kind}`);
    if (hold.kind !== "registered") throw new Error("unreachable");

    const proof = await openPlayRegistrationPaymentProofService.submitOpenPlayRegistrationPaymentProof({
      registrationId: hold.registration.id,
      gcashReference: `RACE-${Date.now()}`,
      submittedAmountCents: 15000,
      screenshot: { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") },
    });

    console.log("Firing 2 concurrent approveOpenPlayRegistrationPaymentProof calls against the same PENDING proof...");
    const context = { employeeId: employee.id, actorUserId: owner.id, shiftId: shift.id, paymentMethodId: gcashMethod.id };
    const [resultA, resultB] = await Promise.all([
      openPlayRegistrationPaymentProofService.approveOpenPlayRegistrationPaymentProof(proof.id, context),
      openPlayRegistrationPaymentProofService.approveOpenPlayRegistrationPaymentProof(proof.id, context),
    ]);

    const winners = [resultA, resultB].filter((r) => !r.alreadyResolved).length;
    const losers = [resultA, resultB].filter((r) => r.alreadyResolved).length;
    console.log(`  Winners (alreadyResolved=false): ${winners}, losers (alreadyResolved=true, benign no-op): ${losers}`);
    assert(winners === 1, `expected exactly 1 winner, got ${winners}`);
    assert(losers === 1, `expected exactly 1 loser (benign no-op), got ${losers}`);

    const sales = await prisma.sale.findMany({ where: { openPlayNightRegistrationId: hold.registration.id } });
    console.log(`  Sale rows created: ${sales.length}`);
    assert(sales.length === 1, `expected exactly 1 Sale row, got ${sales.length}`);

    const regAfter = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: hold.registration.id } });
    assert(regAfter.status === "CONFIRMED", `expected CONFIRMED, got ${regAfter.status}`);

    await cleanUp();
    console.log("PASS: two concurrent approvals of the same proof resolve to exactly one winner, one benign no-op, and exactly one Sale.");
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
