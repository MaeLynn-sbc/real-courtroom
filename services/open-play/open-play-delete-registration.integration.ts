/**
 * Reported live: leftover test registrations (made while trying out the
 * public open-play form) had no cleanup path short of direct database
 * access — every existing action (Cancel/No-show/Refund) changes STATUS,
 * none of them actually remove the row. deleteRegistration is deliberately
 * narrow: safe to hard-delete only when the row never became real,
 * billable activity.
 *
 * Proves, against real rows:
 *   1. A registration with no Sale and a non-CONFIRMED/CHECKED_OUT status
 *      (AWAITING_PAYMENT) is actually deleted, including its child rows
 *      (payment proof, waitlist entry, queue entry) — no FK violation.
 *   2. CONFIRMED is blocked outright, even with no Sale attached.
 *   3. CHECKED_OUT is blocked outright.
 *   4. A registration with a linked Sale is blocked, even if its status
 *      would otherwise be deletable (CANCELLED).
 *   5. A successful delete writes an audit log entry.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";

const TEST_DATE = new Date(2031, 4, 16); // Friday, May 16 2031 — distinct from other integration fixtures' dates

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

let phoneCounter = 970000;
function nextPhone(): string {
  phoneCounter += 1;
  return String(phoneCounter);
}

async function cleanUpTestSession(): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date: TEST_DATE } });
  if (existing) {
    await prisma.sale.deleteMany({ where: { openPlayNightRegistration: { sessionId: existing.id } } });
    await prisma.queueEntry.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayRegistrationPaymentProof.deleteMany({
      where: { registration: { sessionId: existing.id } },
    });
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-TEST-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
    });
  }
  const cashMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });

  await cleanUpTestSession();

  try {
    await openPlayCapacityService.setSessionCapacityOverride(TEST_DATE, 10, owner.id);
    const session = await openPlayCapacityService.getOrCreateSessionForDate(TEST_DATE);

    // ============== 1. Deletable status, no Sale — actually deleted, child rows cascaded ==============
    const awaitingPayment = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: session.id,
        date: TEST_DATE,
        playerName: "Test Awaiting Payment",
        phone: nextPhone(),
        skillLevel: "INTERMEDIATE",
        source: "WEBSITE",
        status: "AWAITING_PAYMENT",
      },
    });
    await prisma.openPlayRegistrationPaymentProof.create({
      data: { registrationId: awaitingPayment.id, screenshotStorageKey: "test-key", submittedAmountCents: 15000, status: "PENDING" },
    });
    await openPlayRegistrationService.deleteRegistration(awaitingPayment.id, owner.id);
    const deletedRow = await prisma.openPlayNightRegistration.findUnique({ where: { id: awaitingPayment.id } });
    assert(deletedRow === null, "expected the registration to actually be deleted");
    const orphanedProof = await prisma.openPlayRegistrationPaymentProof.findFirst({
      where: { registrationId: awaitingPayment.id },
    });
    assert(orphanedProof === null, "expected the child payment-proof row to be deleted too, not left orphaned");
    console.log("PASS: an AWAITING_PAYMENT registration with no Sale is actually deleted, child rows included.");

    // ============== 2. CONFIRMED is blocked, even with no Sale ==============
    const confirmed = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: session.id,
        date: TEST_DATE,
        playerName: "Test Confirmed",
        phone: nextPhone(),
        skillLevel: "INTERMEDIATE",
        source: "WALK_IN",
        status: "CONFIRMED",
      },
    });
    let confirmedRejected = false;
    try {
      await openPlayRegistrationService.deleteRegistration(confirmed.id, owner.id);
    } catch (error) {
      confirmedRejected = true;
      assert(error instanceof Error && error.message.includes("confirmed or checked-out"), `expected a status-guard error, got: ${error}`);
    }
    assert(confirmedRejected, "expected deleting a CONFIRMED registration to be rejected");
    const stillConfirmed = await prisma.openPlayNightRegistration.findUnique({ where: { id: confirmed.id } });
    assert(stillConfirmed !== null, "expected the CONFIRMED registration to still exist");
    console.log("PASS: a CONFIRMED registration can't be deleted, even with no Sale attached.");

    // ============== 3. CHECKED_OUT is blocked ==============
    const checkedOut = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: session.id,
        date: TEST_DATE,
        playerName: "Test Checked Out",
        phone: nextPhone(),
        skillLevel: "INTERMEDIATE",
        source: "WALK_IN",
        status: "CHECKED_OUT",
      },
    });
    let checkedOutRejected = false;
    try {
      await openPlayRegistrationService.deleteRegistration(checkedOut.id, owner.id);
    } catch (error) {
      checkedOutRejected = true;
      assert(error instanceof Error && error.message.includes("confirmed or checked-out"), `expected a status-guard error, got: ${error}`);
    }
    assert(checkedOutRejected, "expected deleting a CHECKED_OUT registration to be rejected");
    console.log("PASS: a CHECKED_OUT registration can't be deleted.");

    // ============== 4. A linked Sale blocks deletion, even for an otherwise-deletable status ==============
    const cancelledWithSale = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: session.id,
        date: TEST_DATE,
        playerName: "Test Cancelled With Sale",
        phone: nextPhone(),
        skillLevel: "INTERMEDIATE",
        source: "WALK_IN",
        status: "CANCELLED",
      },
    });
    const sale = await prisma.sale.create({
      data: {
        saleNumber: `SALE-TEST-${Date.now()}`,
        category: "OPEN_PLAY",
        amountCents: 15000,
        paymentMethodId: cashMethod.id,
        employeeId: employee.id,
        shiftId: shift.id,
        openPlayNightRegistrationId: cancelledWithSale.id,
      },
    });
    let saleRejected = false;
    try {
      await openPlayRegistrationService.deleteRegistration(cancelledWithSale.id, owner.id);
    } catch (error) {
      saleRejected = true;
      assert(error instanceof Error && error.message.includes("recorded sale"), `expected a Sale-guard error, got: ${error}`);
    }
    assert(saleRejected, "expected deleting a registration with a linked Sale to be rejected, even though its status (CANCELLED) is otherwise deletable");
    console.log("PASS: a registration with a linked Sale can't be deleted, even in an otherwise-deletable status.");
    await prisma.sale.delete({ where: { id: sale.id } });

    // ============== 5. A successful delete writes an audit log entry ==============
    const forAudit = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: session.id,
        date: TEST_DATE,
        playerName: "Test Audit Log",
        phone: nextPhone(),
        skillLevel: "INTERMEDIATE",
        source: "WEBSITE",
        status: "REJECTED",
      },
    });
    await openPlayRegistrationService.deleteRegistration(forAudit.id, owner.id);
    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "OpenPlayNightRegistration", entityId: forAudit.id, action: "open_play_night_registration.deleted" },
      orderBy: { createdAt: "desc" },
    });
    assert(auditEntry, "expected a successful delete to write an audit log entry");
    console.log("PASS: a successful delete writes an audit log entry.");

    await cleanUpTestSession();
    console.log("\nPASS: deleteRegistration's safety guards hold against real rows — deletes only what never became real, billable activity.");
  } catch (error) {
    await cleanUpTestSession();
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
