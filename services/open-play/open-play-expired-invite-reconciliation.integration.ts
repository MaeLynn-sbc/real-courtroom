/**
 * Open-play online self-registration, Gate 2 follow-up — closes the
 * "expired invite's seat sits unoffered indefinitely" gap flagged in
 * the Gate 2 review. inviteNextWaitlistEntry only ever runs from
 * releaseRegistration or setSessionCapacityOverride — if an invite
 * lapses and NOTHING else triggers either of those on the same
 * session, the next WAITING entry was never invited. Fix: lazy
 * reconciliation on the capacity/roster screen's own read path
 * (openPlayCheckinService.getCheckInScreenData), same no-cron pattern
 * already used for no-show release (reconcileNoShows).
 *
 * This test drives the scenario with NO cancellation, NO capacity
 * change — only a backdated inviteExpiresAt and then a plain read
 * (getCheckInScreenData), matching exactly what happens when staff
 * simply load the roster screen sometime after a lapsed invite.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { createPublicOpenPlayRegistration } from "./public-open-play-registration.service";
import { settingsService } from "../settings/settings.service";

const TEST_DATE = new Date(2031, 2, 14); // Friday, Mar 14 2031 — distinct from other integration fixtures' dates

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
    // Gate 2 review follow-up: raise the lead-time window so the new
    // registration-opens-N-days-before check (proven on its own in
    // open-play-registration-lead-time.integration.ts) doesn't reject
    // this file's far-future fixture date.
    await settingsService.setOpenPlaySettings(
      { ...(await settingsService.getOpenPlaySettings()), onlineRegistrationLeadTimeDays: 100_000 },
      owner.id,
    );
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(5, true, owner.id);
    await openPlayCapacityService.setSessionCapacityOverride(TEST_DATE, 1, owner.id);
    console.log("Both gates on, capacity set to 1.");

    const holder = await createPublicOpenPlayRegistration({
      playerName: "Expiry Holder",
      phone: "09170000060",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
    });
    assert(holder.status === "registered", `expected the holder to occupy the only seat, got ${holder.status}`);
    if (holder.status !== "registered") throw new Error("unreachable");

    // Free the seat with NO capacity change or cancellation involved yet:
    // cancel the holder so a waiter can be invited, establishing the
    // baseline INVITED state we'll then let lapse.
    const waiter = await createPublicOpenPlayRegistration({
      playerName: "Expiry Waiter",
      phone: "09170000061",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
    });
    assert(waiter.status === "waitlisted", `expected the waiter waitlisted (full), got ${waiter.status}`);
    if (waiter.status !== "waitlisted") throw new Error("unreachable");

    const secondWaiter = await createPublicOpenPlayRegistration({
      playerName: "Expiry Second Waiter",
      phone: "09170000062",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
    });
    assert(secondWaiter.status === "waitlisted", `expected the second waiter waitlisted too, got ${secondWaiter.status}`);
    if (secondWaiter.status !== "waitlisted") throw new Error("unreachable");

    const { openPlayRegistrationService } = await import("./open-play-registration.service");
    await openPlayRegistrationService.cancelRegistration(holder.registrationId, owner.id);

    const waiterEntry = await prisma.openPlayWaitlistEntry.findUniqueOrThrow({ where: { id: waiter.waitlistEntryId } });
    assert(waiterEntry.status === "INVITED", `expected the waiter invited after the holder cancelled, got ${waiterEntry.status}`);
    assert(waiterEntry.registrationId !== null, "expected the invite to have created a real hold");
    console.log("Waiter invited via the normal cancellation path. Now backdating the invite to simulate the 30-minute window lapsing, with NO further cancellation or capacity change to trigger anything.");

    const past = new Date(Date.now() - 60_000);
    await prisma.openPlayWaitlistEntry.update({ where: { id: waiterEntry.id }, data: { inviteExpiresAt: past } });
    await prisma.openPlayNightRegistration.update({ where: { id: waiterEntry.registrationId! }, data: { holdExpiresAt: past } });

    const session = await prisma.openPlayNightSession.findUniqueOrThrow({ where: { date: TEST_DATE } });

    // --- THE GAP, reproduced: a plain read must not silently fix this
    // on its own unless the reconciliation fix is present. Before the
    // fix lands, this assertion is expected to FAIL (the second waiter
    // stays WAITING forever) — that failure IS the proof the gap is
    // real, not hypothetical. After the fix, this same assertion must
    // pass with no other change to the test.
    await openPlayCheckinService.getCheckInScreenData({ sessionId: session.id, date: session.date });

    const secondWaiterEntry = await prisma.openPlayWaitlistEntry.findUniqueOrThrow({ where: { id: secondWaiter.waitlistEntryId } });
    const waiterEntryAfter = await prisma.openPlayWaitlistEntry.findUniqueOrThrow({ where: { id: waiterEntry.id } });
    console.log(`After a plain screen-data read: first waiter=${waiterEntryAfter.status}, second waiter=${secondWaiterEntry.status}`);

    assert(waiterEntryAfter.status === "EXPIRED", `expected the lapsed invite to be resolved to EXPIRED by the screen read, got ${waiterEntryAfter.status}`);
    assert(secondWaiterEntry.status === "INVITED", `expected the second waiter to be invited by the screen read alone (no cancellation/capacity change), got ${secondWaiterEntry.status}`);
    console.log("PASS: loading the roster screen alone (getCheckInScreenData) advances a lapsed invite to the next waiter — no cancellation, no capacity change needed.");

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
