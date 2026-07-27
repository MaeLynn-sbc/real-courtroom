/**
 * Payment-before-play gate — proves checkIn()/checkInAction refuse a
 * registration that isn't CONFIRMED (AWAITING_PAYMENT or
 * PENDING_VERIFICATION), server-side, not just filtered out of the
 * staff check-in list UI. Found by a report-only code audit: before
 * this fix, checkInTx had no status check at all — only
 * getCheckInScreenData's list query filtered to CONFIRMED, which
 * controls what shows up on the screen, not what checkInAction would
 * actually do if called directly against an unpaid/unverified
 * registration's id.
 *
 * Proven failing-first during development: this test was run against
 * the pre-fix code (the status check commented out) and failed exactly
 * as expected — checkIn() succeeded and created a QueueEntry for an
 * AWAITING_PAYMENT registration. Re-enabling the guard turned it green.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCheckinService, RegistrationNotConfirmedError } from "./open-play-checkin.service";

const TEST_DATE = new Date(2031, 0, 20); // Monday, Jan 20 2031 — distinct from other check-in fixtures' dates

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const registrations = await prisma.openPlayNightRegistration.findMany({
    where: { date: TEST_DATE },
    select: { id: true },
  });
  const ids = registrations.map((r) => r.id);
  // Defensive: a pre-fix (or intentionally-disabled-for-the-failing-first-
  // proof) guard can let check-in create a PlayerTab for a registration
  // that should have been refused — clear those first, same as the
  // scenarios test's own cleanup.
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
  const tabIds = tabs.map((t) => t.id);
  await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.queueEntry.deleteMany({ where: { registrationId: { in: ids } } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { date: TEST_DATE } });
}

async function createRegistration(
  status: "AWAITING_PAYMENT" | "PENDING_VERIFICATION" | "CONFIRMED",
  phoneSuffix: string,
) {
  return prisma.openPlayNightRegistration.create({
    data: {
      sessionId: null,
      date: TEST_DATE,
      playerName: `Status Guard Test ${status}`,
      phone: `09170000${phoneSuffix}`,
      skillLevel: "INTERMEDIATE",
      source: "WEBSITE",
      status,
    },
  });
}

async function main(): Promise<void> {
  await cleanUp();

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  try {
    // ============== AWAITING_PAYMENT — refused ==============
    const awaitingPayment = await createRegistration("AWAITING_PAYMENT", "01");
    let awaitingPaymentRejected = false;
    try {
      await openPlayCheckinService.checkIn(awaitingPayment.id, owner.id);
    } catch (error) {
      awaitingPaymentRejected = true;
      assert(
        error instanceof RegistrationNotConfirmedError,
        `expected a RegistrationNotConfirmedError, got: ${error}`,
      );
    }
    assert(awaitingPaymentRejected, "expected check-in to be refused for an AWAITING_PAYMENT registration");
    const awaitingPaymentAfter = await prisma.openPlayNightRegistration.findUniqueOrThrow({
      where: { id: awaitingPayment.id },
    });
    assert(awaitingPaymentAfter.checkedInAt === null, "expected checkedInAt to remain null after the refused attempt");
    const awaitingPaymentQueueEntry = await prisma.queueEntry.findUnique({
      where: { registrationId: awaitingPayment.id },
    });
    assert(awaitingPaymentQueueEntry === null, "expected no QueueEntry to have been created");
    console.log("PASS: check-in refuses an AWAITING_PAYMENT registration — no checked-in state, no QueueEntry.");

    // ============== PENDING_VERIFICATION — refused ==============
    const pendingVerification = await createRegistration("PENDING_VERIFICATION", "02");
    let pendingVerificationRejected = false;
    try {
      await openPlayCheckinService.checkIn(pendingVerification.id, owner.id);
    } catch (error) {
      pendingVerificationRejected = true;
      assert(
        error instanceof RegistrationNotConfirmedError,
        `expected a RegistrationNotConfirmedError, got: ${error}`,
      );
    }
    assert(pendingVerificationRejected, "expected check-in to be refused for a PENDING_VERIFICATION registration");
    console.log("PASS: check-in refuses a PENDING_VERIFICATION registration.");

    // ============== CONFIRMED — succeeds (control case) ==============
    const confirmed = await createRegistration("CONFIRMED", "03");
    const result = await openPlayCheckinService.checkIn(confirmed.id, owner.id);
    assert(result.alreadyCheckedIn === false, "expected a fresh CONFIRMED check-in to succeed");
    assert(result.queueEntriesCreated.length === 1, "expected exactly one QueueEntry created");
    console.log("PASS: check-in succeeds normally for a CONFIRMED registration (control case, unaffected by the guard).");

    await cleanUp();
    console.log("\nPASS: check-in's CONFIRMED-status guard proven against real rows.");
  } catch (error) {
    await cleanUp();
    throw error;
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUp();
  process.exit(1);
});
