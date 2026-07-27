/**
 * Cancellation policy Gate 1 — proves, against real rows:
 *   1. Cancelling a CONFIRMED (paid) Fri/Sat registration BEFORE the
 *      4-hour cutoff issues an OpenPlayCredit for the exact fee amount.
 *   2. Cancelling one AFTER the cutoff issues no credit — fee forfeited,
 *      no cash moves either way.
 *   3. NO_SHOW never issues a credit, even before what would have been
 *      the cutoff — gated strictly on status === "CANCELLED".
 *   4. REJECTED never issues a credit — no Sale ever existed to base
 *      one on (Sale is only created on approval, never on submission).
 *   5. The staff refund path (refundRegistration): creates a real
 *      OpenPlayRefund row, requires a reason (failing-first), and never
 *      touches the registration's own status.
 *   6. The customer-facing cancellation path (cancelRegistrationAsCustomer):
 *      succeeds with the correct phone, is refused with the wrong phone
 *      (failing-first — registration stays CONFIRMED), and is refused
 *      outright for a WALK_IN-sourced registration even with the
 *      correct phone (scoped to source === "WEBSITE" only).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { settingsService } from "../settings/settings.service";

const TEST_DATE_A = new Date(2031, 2, 7); // Friday, Mar 7 2031 — "before cutoff" session
const TEST_DATE_B = new Date(2031, 2, 8); // Saturday, Mar 8 2031 — "after cutoff" session
const TEST_DATE_C = new Date(2031, 2, 14); // Friday, Mar 14 2031 — no-show / rejected / refund / customer-cancel fixtures

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const sessions = await prisma.openPlayNightSession.findMany({
    where: { date: { in: [TEST_DATE_A, TEST_DATE_B, TEST_DATE_C] } },
    select: { id: true },
  });
  const sessionIds = sessions.map((s) => s.id);
  const registrations = await prisma.openPlayNightRegistration.findMany({
    where: { sessionId: { in: sessionIds } },
    select: { id: true },
  });
  const registrationIds = registrations.map((r) => r.id);
  await prisma.openPlayRefund.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.openPlayCredit.deleteMany({ where: { sourceRegistrationId: { in: registrationIds } } });
  await prisma.sale.deleteMany({ where: { openPlayNightRegistrationId: { in: registrationIds } } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.openPlayNightSession.deleteMany({ where: { id: { in: sessionIds } } });
}

async function main(): Promise<void> {
  await cleanUp();

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const { friSatRegistrationFeeCents } = await settingsService.getOpenPlaySettings();
  assert(friSatRegistrationFeeCents > 0, "sanity check: expected a non-zero registration fee for this test to be meaningful");

  const now = Date.now();
  const ownerEmployee = await prisma.employee.findFirstOrThrow({ where: { userId: owner.id } });
  const ownerShift = await prisma.shift.findFirstOrThrow({ where: { employeeId: ownerEmployee.id } });
  const ownerSaleContext = {
    method: "CASH" as const,
    gcashReference: null,
    paymentMethodId: cashMethod.id,
    employeeId: ownerEmployee.id,
    shiftId: ownerShift.id,
  };

  try {
    // ============== 1. Before cutoff — credit issued ==============
    const sessionA = await prisma.openPlayNightSession.create({
      data: {
        date: TEST_DATE_A,
        startAt: new Date(now + 10 * 60 * 60 * 1000), // 10h from now — cutoff is 6h from now, "now" is before it
        endAt: new Date(now + 15 * 60 * 60 * 1000),
        capacity: 20,
      },
    });
    const regA = await openPlayRegistrationService.registerWalkIn(
      sessionA.id,
      { playerName: "Before Cutoff", phone: "09170000101", skillLevel: "INTERMEDIATE" },
      owner.id,
      ownerSaleContext,
    );
    await openPlayRegistrationService.cancelRegistration(regA.id, owner.id);
    const creditA = await prisma.openPlayCredit.findFirst({ where: { sourceRegistrationId: regA.id } });
    assert(creditA !== null, "expected an OpenPlayCredit to be issued for a before-cutoff cancellation");
    assert(creditA!.amountCents === friSatRegistrationFeeCents, `expected credit amount ${friSatRegistrationFeeCents}, got ${creditA!.amountCents}`);
    assert(creditA!.phone === "09170000101", `expected credit phone to match the registration's phone, got ${creditA!.phone}`);
    assert(creditA!.usedAt === null, "expected a freshly issued credit to be unused");
    const expectedExpiryMs = creditA!.issuedAt.getTime() + 90 * 24 * 60 * 60 * 1000;
    assert(
      Math.abs((creditA!.expiresAt?.getTime() ?? 0) - expectedExpiryMs) < 5000,
      `expected expiresAt ~90 days from issuedAt, got issuedAt=${creditA!.issuedAt.toISOString()} expiresAt=${creditA!.expiresAt?.toISOString()}`,
    );
    console.log("PASS: cancelling before the 4-hour cutoff issues a credit for the exact fee amount, expiring ~90 days out.");

    // ============== 2. After cutoff — no credit ==============
    const sessionB = await prisma.openPlayNightSession.create({
      data: {
        date: TEST_DATE_B,
        startAt: new Date(now + 2 * 60 * 60 * 1000), // 2h from now — cutoff was 2h AGO, "now" is at/after it
        endAt: new Date(now + 7 * 60 * 60 * 1000),
        capacity: 20,
      },
    });
    const regB = await openPlayRegistrationService.registerWalkIn(
      sessionB.id,
      { playerName: "After Cutoff", phone: "09170000102", skillLevel: "INTERMEDIATE" },
      owner.id,
      ownerSaleContext,
    );
    await openPlayRegistrationService.cancelRegistration(regB.id, owner.id);
    const creditB = await prisma.openPlayCredit.findFirst({ where: { sourceRegistrationId: regB.id } });
    assert(creditB === null, "expected NO credit for an after-cutoff cancellation — fee forfeited");
    console.log("PASS: cancelling at/after the 4-hour cutoff issues no credit — fee forfeited, no cash back either way.");

    // ============== 3. NO_SHOW — never issues credit ==============
    const sessionC = await prisma.openPlayNightSession.create({
      data: {
        date: TEST_DATE_C,
        startAt: new Date(now + 10 * 60 * 60 * 1000), // well before cutoff time-wise — must still forfeit
        endAt: new Date(now + 15 * 60 * 60 * 1000),
        capacity: 20,
      },
    });
    const regNoShow = await openPlayRegistrationService.registerWalkIn(
      sessionC.id,
      { playerName: "No Show", phone: "09170000103", skillLevel: "INTERMEDIATE" },
      owner.id,
      ownerSaleContext,
    );
    await openPlayRegistrationService.markNoShow(regNoShow.id, owner.id);
    const creditNoShow = await prisma.openPlayCredit.findFirst({ where: { sourceRegistrationId: regNoShow.id } });
    assert(creditNoShow === null, "expected NO credit for a no-show, even though it's technically before the time-based cutoff");
    console.log("PASS: a no-show never issues a credit — gated strictly on status === CANCELLED, not on timing alone.");

    // ============== 4. REJECTED — never issues credit (no Sale ever existed) ==============
    const regRejected = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: sessionC.id,
        date: TEST_DATE_C,
        playerName: "Rejected Proof",
        phone: "09170000104",
        skillLevel: "INTERMEDIATE",
        source: "WEBSITE",
        status: "PENDING_VERIFICATION",
      },
    });
    await openPlayRegistrationService.rejectRegistration(regRejected.id, owner.id);
    const creditRejected = await prisma.openPlayCredit.findFirst({ where: { sourceRegistrationId: regRejected.id } });
    assert(creditRejected === null, "expected NO credit for a rejected registration — no Sale ever existed");
    console.log("PASS: a rejected registration never issues a credit — nothing was ever paid.");

    // ============== 5. Staff refund path ==============
    let missingReasonRejected = false;
    try {
      await openPlayRegistrationService.refundRegistration(regA.id, friSatRegistrationFeeCents, "", ownerEmployee.id, owner.id);
    } catch (error) {
      missingReasonRejected = true;
      assert(error instanceof Error && /reason/i.test(error.message), `expected a reason-related error, got: ${error}`);
    }
    assert(missingReasonRejected, "expected a refund with no reason to be rejected — proven failing-first");

    const refund = await openPlayRegistrationService.refundRegistration(
      regA.id,
      friSatRegistrationFeeCents,
      "Double payment — customer paid twice by mistake.",
      ownerEmployee.id,
      owner.id,
    );
    assert(refund.amountCents === friSatRegistrationFeeCents, `expected refund amount ${friSatRegistrationFeeCents}, got ${refund.amountCents}`);
    assert(refund.employeeId === ownerEmployee.id, "expected the refund to be attributed to a real Employee");
    const refundAudit = await prisma.auditLog.findFirst({
      where: { entityType: "OpenPlayRefund", entityId: refund.id, action: "open_play_night_registration.refunded" },
    });
    assert(refundAudit !== null, "expected the refund to be audit-logged");
    const regAAfterRefund = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: regA.id } });
    assert(regAAfterRefund.status === "CANCELLED", "expected the refund to NOT change the registration's own status (it was already CANCELLED from step 1)");
    console.log("PASS: staff refund requires a reason (failing-first), creates an audit-logged OpenPlayRefund, and never touches the registration's status.");

    // ============== 6. Customer-facing cancellation ==============
    const regCustomer = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: sessionC.id,
        date: TEST_DATE_C,
        playerName: "Customer Self Cancel",
        phone: "09170000105",
        skillLevel: "INTERMEDIATE",
        source: "WEBSITE",
        status: "CONFIRMED",
      },
    });

    let wrongPhoneRejected = false;
    try {
      await openPlayRegistrationService.cancelRegistrationAsCustomer(regCustomer.id, "09999999999");
    } catch {
      wrongPhoneRejected = true;
    }
    assert(wrongPhoneRejected, "expected a wrong-phone cancellation attempt to be refused — proven failing-first");
    const regCustomerAfterWrongPhone = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: regCustomer.id } });
    assert(regCustomerAfterWrongPhone.status === "CONFIRMED", "expected the registration to remain CONFIRMED after a refused wrong-phone attempt");

    // Correct phone, but formatted differently (spaces/dashes) — proves
    // the normalize-and-compare shape, not exact-string matching.
    await openPlayRegistrationService.cancelRegistrationAsCustomer(regCustomer.id, "0917-000-0105");
    const regCustomerAfter = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: regCustomer.id } });
    assert(regCustomerAfter.status === "CANCELLED", `expected the registration to be CANCELLED after a correct-phone attempt, got ${regCustomerAfter.status}`);
    console.log("PASS: customer-facing cancellation refuses a wrong phone number, and succeeds with the correct one (normalized).");

    // WALK_IN-sourced registration — refused even with the correct phone.
    let walkInRejected = false;
    try {
      await openPlayRegistrationService.cancelRegistrationAsCustomer(regNoShow.id, "09170000103");
    } catch {
      walkInRejected = true;
    }
    assert(walkInRejected, "expected a WALK_IN-sourced registration to be refused by the customer-facing cancellation path, even with the correct phone");
    console.log("PASS: customer-facing cancellation refuses a WALK_IN-sourced registration — scoped to WEBSITE only, per the instruction that created it.");

    await cleanUp();
    console.log("\nPASS: cancellation policy (credit, forfeit, staff refund, customer-facing cancel) proven against real rows.");
  } catch (error) {
    await cleanUp();
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
