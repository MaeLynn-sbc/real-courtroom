/**
 * Waitlist fairness gap, found while investigating QR-code registration
 * rollout risk: reconcileExpiredInvites' own pre-check only looks for a
 * stale OpenPlayWaitlistEntry in "INVITED" status
 * (open-play-expired-invite-reconciliation.integration.ts proves THAT
 * case works). A first-time online registration's own AWAITING_PAYMENT
 * hold expiring never creates an INVITED row in the first place — nobody
 * has been through the invite cycle yet — so the pre-check finds nothing,
 * takes no lock, and never invites the earliest waitlisted person. The
 * seat is still genuinely free (countOccupiedSeats already excludes the
 * expired hold), so it goes to whoever submits next, not FCFS to the
 * person who's been waiting.
 *
 * Person A/B/C reproduction: A registers (fills the only seat), B
 * registers (waitlisted), A's hold is force-expired with NO cancellation
 * and NO capacity change, staff load the roster screen (the one thing
 * that's supposed to catch this lazily), then C submits a brand-new
 * registration. Before the fix: B is still WAITING and C takes the seat
 * — this exact assertion is expected to FAIL pre-fix, proving the gap is
 * real, not hypothetical. After the fix: B is invited by the roster-
 * screen read alone, so C's fresh submission correctly lands on the
 * waitlist behind B instead of stealing B's seat.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { createPublicOpenPlayRegistration } from "./public-open-play-registration.service";
import { settingsService } from "../settings/settings.service";

const TEST_DATE = new Date(2031, 2, 21); // Friday, Mar 21 2031 — distinct from the sibling reconciliation test's date

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function dateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function cleanUpTestSession(): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date: TEST_DATE } });
  if (existing) {
    await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  await cleanUpTestSession();

  try {
    await settingsService.setOpenPlayOnlineRegistrationEnabled(true, owner.id);
    await settingsService.setOpenPlaySettings(
      { ...(await settingsService.getOpenPlaySettings()), onlineRegistrationLeadTimeDays: 100_000 },
      owner.id,
    );
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(5, true, owner.id);
    await openPlayCapacityService.setSessionCapacityOverride(TEST_DATE, 1, owner.id);
    console.log("Both gates on, capacity set to 1.");

    const personA = await createPublicOpenPlayRegistration({
      playerName: "Person A",
      phone: "09170000070",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
    });
    assert(personA.status === "registered", `expected A to occupy the only seat, got ${personA.status}`);
    if (personA.status !== "registered") throw new Error("unreachable");

    const personB = await createPublicOpenPlayRegistration({
      playerName: "Person B (waits first)",
      phone: "09170000071",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
    });
    assert(personB.status === "waitlisted", `expected B waitlisted (full), got ${personB.status}`);
    if (personB.status !== "waitlisted") throw new Error("unreachable");

    // A's hold lapses. NO cancellation, NO capacity change — the exact
    // condition reconcileExpiredInvites' pre-check misses today, since
    // no OpenPlayWaitlistEntry has ever reached "INVITED" in this
    // session.
    const past = new Date(Date.now() - 60_000);
    await prisma.openPlayNightRegistration.update({
      where: { id: personA.registrationId },
      data: { holdExpiresAt: past },
    });
    console.log("A's hold force-expired. No cancellation, no capacity change. Loading the roster screen — the one thing that's supposed to catch this lazily.");

    const session = await prisma.openPlayNightSession.findUniqueOrThrow({ where: { date: TEST_DATE } });
    await openPlayCheckinService.getCheckInScreenData({ sessionId: session.id, date: session.date });

    const personBEntry = await prisma.openPlayWaitlistEntry.findUniqueOrThrow({ where: { id: personB.waitlistEntryId } });
    console.log(`After a plain screen-data read: Person B's waitlist status = ${personBEntry.status}`);

    // --- THE GAP, reproduced: before the fix, B is never invited by the
    // screen read (this assertion fails). After the fix, it passes with
    // no other change to the test.
    assert(personBEntry.status === "INVITED", `expected B to be invited once A's hold lapsed and the roster screen was read, got ${personBEntry.status}`);
    console.log("PASS: a first-time hold expiring, with nobody ever previously invited, still gets caught by the roster screen's own lazy read.");

    // Confirms the fairness property end to end, not just the internal
    // status flip: a brand-new Person C submitting AFTER B was invited
    // must land on the waitlist BEHIND B, not steal B's seat.
    const personC = await createPublicOpenPlayRegistration({
      playerName: "Person C (submits after A expires)",
      phone: "09170000072",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
    });
    assert(
      personC.status === "waitlisted",
      `expected C to land on the waitlist behind B (whose invite hold now occupies the only seat), got ${personC.status}`,
    );
    console.log("PASS: Person C correctly waitlists behind Person B instead of taking the seat B waited for.");

    await cleanUpTestSession();
  } finally {
    await settingsService.setOpenPlayOnlineRegistrationEnabled(true, owner.id);
    await settingsService.setOpenPlaySettings(
      { ...(await settingsService.getOpenPlaySettings()), onlineRegistrationLeadTimeDays: 4 },
      owner.id,
    );
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(5, true, owner.id);
    const restored = await settingsService.getOpenPlayOnlineRegistrationEnabled();
    console.log(`Feature-wide switch restored to ON (verified: ${restored === true}).`);
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
