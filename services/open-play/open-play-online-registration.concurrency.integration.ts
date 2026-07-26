/**
 * Open-play online self-registration, Gate 2 — concurrency, same §15
 * pattern 1 (SELECT ... FOR UPDATE on the session row) the existing
 * registerWalkIn/releaseRegistration already use, not a new pattern:
 * submitOnlineRegistration and inviteNextWaitlistEntry both acquire the
 * identical session lock before deciding anything, so they serialize
 * through it exactly like a walk-in racing another walk-in does today.
 *
 * Two scenarios:
 *   1. Two people submitting online for the SAME session's one
 *      remaining seat, concurrently — exactly one gets a real hold, the
 *      other is correctly waitlisted, never both.
 *   2. Two slot-freeing events firing concurrently (two cancellations)
 *      against a session with only one waiting entry — the entry gets
 *      invited exactly once, never twice.
 *
 * tsx script, not Jest — same reason as open-play-registration
 * .concurrency.integration.ts (Jest's CJS module system can't load
 * Prisma 7's WASM query compiler). Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { createPublicOpenPlayRegistration } from "./public-open-play-registration.service";
import { settingsService } from "../settings/settings.service";

const RACE_DATE = new Date(2031, 1, 21); // Friday, Feb 21 2031 — distinct from other integration fixtures' dates
const INVITE_RACE_DATE = new Date(2031, 1, 28); // Friday, Feb 28 2031

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function dateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function cleanUpSession(date: Date): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date } });
  if (existing) {
    await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
  }
}

async function raceForLastSeat(ownerId: string): Promise<void> {
  await cleanUpSession(RACE_DATE);
  await openPlayCapacityService.setSessionCapacityOverride(RACE_DATE, 1, ownerId);

  console.log("Firing 2 concurrent online submissions for a session with exactly 1 seat...");
  const [resultA, resultB] = await Promise.all([
    createPublicOpenPlayRegistration({
      playerName: "Race Guest A",
      phone: "09170000030",
      skillLevel: "INTERMEDIATE",
      date: dateValue(RACE_DATE),
    }),
    createPublicOpenPlayRegistration({
      playerName: "Race Guest B",
      phone: "09170000031",
      skillLevel: "INTERMEDIATE",
      date: dateValue(RACE_DATE),
    }),
  ]);

  const registered = [resultA, resultB].filter((r) => r.status === "registered");
  const waitlisted = [resultA, resultB].filter((r) => r.status === "waitlisted");
  console.log(`  Registered: ${registered.length}, waitlisted: ${waitlisted.length}`);
  assert(registered.length === 1, `expected exactly 1 registered, got ${registered.length}`);
  assert(waitlisted.length === 1, `expected exactly 1 waitlisted, got ${waitlisted.length}`);

  const session = await prisma.openPlayNightSession.findUniqueOrThrow({ where: { date: RACE_DATE } });
  const holdsInDb = await prisma.openPlayNightRegistration.count({
    where: { sessionId: session.id, status: "AWAITING_PAYMENT" },
  });
  assert(holdsInDb === 1, `expected exactly 1 AWAITING_PAYMENT hold in the database, got ${holdsInDb}`);

  await cleanUpSession(RACE_DATE);
  console.log("PASS: 2 concurrent online submissions for the same last seat never both succeed.");
}

async function raceToInviteOnce(ownerId: string): Promise<void> {
  await cleanUpSession(INVITE_RACE_DATE);
  await openPlayCapacityService.setOnlineRegistrationEnabledForDay(6, true, ownerId);
  await openPlayCapacityService.setSessionCapacityOverride(INVITE_RACE_DATE, 2, ownerId);

  // Fill both seats with online holds, then queue exactly one waiter —
  // the one entry both concurrent releases below will race to invite.
  const holderA = await createPublicOpenPlayRegistration({
    playerName: "Invite Race Holder A",
    phone: "09170000040",
    skillLevel: "INTERMEDIATE",
    date: dateValue(INVITE_RACE_DATE),
  });
  const holderB = await createPublicOpenPlayRegistration({
    playerName: "Invite Race Holder B",
    phone: "09170000041",
    skillLevel: "INTERMEDIATE",
    date: dateValue(INVITE_RACE_DATE),
  });
  assert(holderA.status === "registered" && holderB.status === "registered", "expected both seats filled before the race");
  if (holderA.status !== "registered" || holderB.status !== "registered") throw new Error("unreachable");

  const waiter = await createPublicOpenPlayRegistration({
    playerName: "Invite Race Waiter",
    phone: "09170000042",
    skillLevel: "INTERMEDIATE",
    date: dateValue(INVITE_RACE_DATE),
  });
  assert(waiter.status === "waitlisted", "expected the third submission to be waitlisted (session full)");
  if (waiter.status !== "waitlisted") throw new Error("unreachable");

  console.log("Firing 2 concurrent cancellations (both A's and B's holds) — both try to invite the same single waiter...");
  await Promise.all([
    openPlayRegistrationService.cancelRegistration(holderA.registrationId, ownerId),
    openPlayRegistrationService.cancelRegistration(holderB.registrationId, ownerId),
  ]);

  const waiterAfter = await prisma.openPlayWaitlistEntry.findUniqueOrThrow({ where: { id: waiter.waitlistEntryId } });
  console.log(`  Waiter status after the race: ${waiterAfter.status}`);
  assert(waiterAfter.status === "INVITED", `expected the waiter to be invited exactly once, got ${waiterAfter.status}`);

  const invitedRegistrations = await prisma.openPlayNightRegistration.count({
    where: { sessionId: waiterAfter.sessionId, phone: "09170000042", status: "AWAITING_PAYMENT" },
  });
  assert(
    invitedRegistrations === 1,
    `expected exactly 1 hold created for the waiter across both concurrent releases, got ${invitedRegistrations}`,
  );

  await cleanUpSession(INVITE_RACE_DATE);
  console.log("PASS: 2 concurrent slot-freeing events never both invite the same waiting entry.");
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  try {
    await settingsService.setOpenPlayOnlineRegistrationEnabled(true, owner.id);
    // Gate 2 review follow-up: raise the lead-time window so the new
    // registration-opens-N-days-before check (proven on its own in
    // open-play-registration-lead-time.integration.ts) doesn't reject
    // this file's far-future fixture dates.
    await settingsService.setOpenPlaySettings(
      { ...(await settingsService.getOpenPlaySettings()), onlineRegistrationLeadTimeDays: 100_000 },
      owner.id,
    );
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(5, true, owner.id);

    await raceForLastSeat(owner.id);
    await raceToInviteOnce(owner.id);

    console.log("\nAll open-play online registration concurrency scenarios passed.");
  } finally {
    await settingsService.setOpenPlayOnlineRegistrationEnabled(false, owner.id);
    await settingsService.setOpenPlaySettings(
      { ...(await settingsService.getOpenPlaySettings()), onlineRegistrationLeadTimeDays: 4 },
      owner.id,
    );
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(6, true, owner.id);
    const restored = await settingsService.getOpenPlayOnlineRegistrationEnabled();
    console.log(`Feature-wide switch restored to OFF (verified: ${restored === false}).`);
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
