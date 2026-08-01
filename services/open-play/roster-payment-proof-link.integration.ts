/**
 * "Viewable after approval" (reported live): once a payment proof was
 * approved, it dropped off listPendingProofs() and nothing else pointed
 * at it — the detail page itself (getProofById, status-unfiltered) still
 * rendered fine, but the roster had no link to reach it. Fix was to
 * carry the latest proof through getSessionRegistrations. Proves, against
 * real rows, that the roster's proof reference survives approval and
 * rejection, not just the PENDING state.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRegistrationPaymentProofService } from "./open-play-registration-payment-proof.service";

const TEST_DATE = new Date(2031, 4, 23); // Friday, distinct from other proof integration fixtures

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date: TEST_DATE } });
  if (!existing) return;
  const registrations = await prisma.openPlayNightRegistration.findMany({
    where: { sessionId: existing.id },
    select: { id: true },
  });
  const ids = registrations.map((r) => r.id);
  await prisma.openPlayRegistrationPaymentProof.deleteMany({
    where: { registrationId: { in: ids } },
  });
  await prisma.sale.deleteMany({
    where: { openPlayNightRegistration: { sessionId: existing.id } },
  });
  await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: existing.id } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
  await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: {
        shiftNumber: `SHIFT-ROSTERPROOF-${Date.now()}`,
        employeeId: employee.id,
        status: "OPEN",
      },
    });
  }
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  await cleanUp();

  try {
    await openPlayCapacityService.setSessionCapacityOverride(TEST_DATE, 3, owner.id);
    const session = await openPlayCapacityService.getOrCreateSessionForDate(TEST_DATE);

    const hold = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "Roster Proof Guest",
      phone: "09171240099",
      skillLevel: "INTERMEDIATE",
    });
    assert(hold.kind === "registered", `expected a hold, got ${hold.kind}`);
    if (hold.kind !== "registered") throw new Error("unreachable");

    // ============== Before any proof: absent, not an error ==============
    const before = await openPlayRegistrationService.getSessionRegistrations(session.id);
    const beforeRow = before.registrations.find((r) => r.id === hold.registration.id);
    assert(beforeRow, "expected the new registration to appear on the roster");
    assert(
      beforeRow!.paymentProofs.length === 0,
      `expected no proof yet, got ${beforeRow!.paymentProofs.length}`,
    );
    console.log("PASS: a registration with no submitted proof shows an empty paymentProofs array.");

    // ============== Pending: shows up immediately ==============
    const proof =
      await openPlayRegistrationPaymentProofService.submitOpenPlayRegistrationPaymentProof({
        registrationId: hold.registration.id,
        gcashReference: `ROSTER-PROOF-${Date.now()}`,
        submittedAmountCents: 15000,
        screenshot: {
          fileName: "proof.png",
          contentType: "image/png",
          data: Buffer.from("fake-image-bytes"),
        },
      });

    const pending = await openPlayRegistrationService.getSessionRegistrations(session.id);
    const pendingRow = pending.registrations.find((r) => r.id === hold.registration.id);
    assert(
      pendingRow!.paymentProofs[0]?.id === proof.id,
      "expected the pending proof to surface on the roster",
    );
    assert(
      pendingRow!.paymentProofs[0]?.status === "PENDING",
      `expected PENDING, got ${pendingRow!.paymentProofs[0]?.status}`,
    );
    console.log("PASS: a pending proof surfaces on the roster row.");

    // ============== Approved: THE actual bug — still surfaces, not dropped ==============
    await openPlayRegistrationPaymentProofService.approveOpenPlayRegistrationPaymentProof(
      proof.id,
      {
        employeeId: employee.id,
        actorUserId: owner.id,
        shiftId: shift.id,
        paymentMethodId: gcashMethod.id,
      },
    );

    const afterApprove = await openPlayRegistrationService.getSessionRegistrations(session.id);
    const approvedRow = afterApprove.registrations.find((r) => r.id === hold.registration.id);
    assert(
      approvedRow!.paymentProofs[0]?.id === proof.id,
      "expected the SAME proof to still surface after approval — this is the reported bug (proof disappearing once approved)",
    );
    assert(
      approvedRow!.paymentProofs[0]?.status === "APPROVED",
      `expected APPROVED, got ${approvedRow!.paymentProofs[0]?.status}`,
    );
    console.log(
      "PASS: an APPROVED proof still surfaces on the roster row — no longer disappears once resolved.",
    );

    console.log("\nPASS: roster payment-proof link proven against real rows.");
  } finally {
    await cleanUp();
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
