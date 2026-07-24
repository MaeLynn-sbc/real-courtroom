/**
 * BUILD-SPEC.md §7's required correctness tests, run against real Postgres:
 *
 *   1. "One advanced player among 20 beginners still plays within
 *      maxWaitMinutes" — the starvation guard. The one that matters most
 *      per the user's explicit ask: anchor selection always picks the
 *      longest-waiting unit regardless of skill, and widening to "any
 *      level" ensures a lone outlier isn't stuck waiting for a same-skill
 *      match that will never come on a beginner-heavy night.
 *   2. "A party of 3 stays together, matched on average skill."
 *   3. "Manual override is never overwritten by a later auto-proposal."
 *   4. "A court never sits idle while 4+ players wait" (and, conversely,
 *      correctly stays idle with only 3).
 *
 * Run via `npm run test:integration` (see run-integration-tests.ts). Uses
 * weeknight registrations throughout (no session/capacity needed) — the
 * rotation logic being tested is keyed by `date`, identical for weeknight
 * and Fri/Sat. Each scenario uses its own date so they can run against the
 * same seeded courts without interfering with each other.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRotationService } from "./open-play-rotation.service";
import { settingsService } from "../settings/settings.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const STARVATION_DATE = new Date(2031, 0, 9); // Thursday
const PARTY_DATE = new Date(2031, 0, 13); // Monday
const MANUAL_OVERRIDE_DATE = new Date(2031, 0, 14); // Tuesday
const COURT_IDLE_DATE = new Date(2031, 0, 15); // Wednesday

const ALL_DATES = [STARVATION_DATE, PARTY_DATE, MANUAL_OVERRIDE_DATE, COURT_IDLE_DATE];

async function cleanUp(): Promise<void> {
  await prisma.gameAssignment.deleteMany({ where: { date: { in: ALL_DATES } } });
  await prisma.recentPairing.deleteMany({ where: { date: { in: ALL_DATES } } });
  await prisma.queueEntry.deleteMany({ where: { date: { in: ALL_DATES } } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { date: { in: ALL_DATES } } });
}

let phoneCounter = 900000;
function nextPhone(): string {
  phoneCounter += 1;
  return String(phoneCounter);
}

// Solo only — mirrors the real "walk-in button" (register + check in as one
// action, BUILD-SPEC.md §6), which is how most solo players arrive.
async function checkInBackdated(
  date: Date,
  playerName: string,
  skillLevel: "BEGINNER" | "NOVICE" | "INTERMEDIATE" | "ADVANCED",
  actorUserId: string,
  minutesAgo: number,
): Promise<string> {
  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    date,
    { playerName, phone: nextPhone(), skillLevel },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);

  const backdated = new Date(Date.now() - minutesAgo * 60_000);
  await prisma.openPlayNightRegistration.update({ where: { id: registration.id }, data: { checkedInAt: backdated } });
  await prisma.queueEntry.updateMany({ where: { registrationId: registration.id }, data: { joinedQueueAt: backdated } });

  return registration.id;
}

// Party — BUILD-SPEC.md §6 "a party enters the queue only when all members
// are checked in." Real usage registers every member up front (shared
// partyId, checkedInAt null), then checks each in individually as they
// arrive; only the last check-in completes the group and creates queue
// entries for all of them. Registering-and-checking-in each member as one
// combined action (like the solo helper above) is wrong for a party — the
// first member alone would look like a vacuously-complete "party of 1" to
// checkIn's allArrived check.
async function registerAndCheckInParty(
  date: Date,
  partyId: string,
  members: { playerName: string; skillLevel: "BEGINNER" | "NOVICE" | "INTERMEDIATE" | "ADVANCED" }[],
  actorUserId: string,
  minutesAgo: number,
): Promise<string[]> {
  const registrationIds: string[] = [];
  for (const member of members) {
    const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
      date,
      { playerName: member.playerName, phone: nextPhone(), skillLevel: member.skillLevel, partyId },
      actorUserId,
    );
    registrationIds.push(registration.id);
  }
  for (const registrationId of registrationIds) {
    await openPlayCheckinService.checkIn(registrationId, actorUserId);
  }

  const backdated = new Date(Date.now() - minutesAgo * 60_000);
  await prisma.openPlayNightRegistration.updateMany({ where: { id: { in: registrationIds } }, data: { checkedInAt: backdated } });
  await prisma.queueEntry.updateMany({ where: { registrationId: { in: registrationIds } }, data: { joinedQueueAt: backdated } });

  return registrationIds;
}

async function testStarvationGuard(courtId: string, actorUserId: string): Promise<void> {
  const settings = await settingsService.getOpenPlaySettings();

  const beginnerIds: string[] = [];
  for (let i = 0; i < 20; i++) {
    beginnerIds.push(await checkInBackdated(STARVATION_DATE, `Beginner ${i}`, "BEGINNER", actorUserId, 0));
  }
  const advancedId = await checkInBackdated(
    STARVATION_DATE,
    "Lone Advanced",
    "ADVANCED",
    actorUserId,
    settings.maxWaitMinutes + 5,
  );

  const assignment = await openPlayRotationService.proposeNextAssignment(STARVATION_DATE, courtId, actorUserId);
  assert(assignment, "expected a proposed assignment with 21 waiting players");
  assert(assignment!.participants.length === 4, "assignment should have exactly 4 participants");

  const participantIds = assignment!.participants.map((p) => p.registrationId);
  assert(
    participantIds.includes(advancedId),
    "the lone advanced player, waiting past maxWaitMinutes, must be in the very next proposed assignment regardless of skill fit",
  );
  const includedBeginners = participantIds.filter((id) => beginnerIds.includes(id));
  assert(includedBeginners.length === 3, "the other 3 seats should be filled by beginners (widened to any level)");
  assert(assignment!.skillSpread === 3, `expected skillSpread 3 (advanced=4 minus beginner=1), got ${assignment!.skillSpread}`);

  console.log("PASS: starvation guard — lone advanced player included in the very next proposal");
}

async function testPartyAverageSkill(courtId: string, actorUserId: string): Promise<void> {
  const partyId = `party-${Date.now()}`;
  // Average skill = (1 + 3 + 4) / 3 = 2.67 — checked in earliest (as a
  // group) so the party anchors.
  const partyMemberIds = await registerAndCheckInParty(
    PARTY_DATE,
    partyId,
    [
      { playerName: "Party Beginner", skillLevel: "BEGINNER" },
      { playerName: "Party Intermediate", skillLevel: "INTERMEDIATE" },
      { playerName: "Party Advanced", skillLevel: "ADVANCED" },
    ],
    actorUserId,
    30,
  );

  // One solo candidate, closest in skill to the party's ~2.67 average,
  // checked in after the party so it can't out-wait the party for anchor.
  const soloId = await checkInBackdated(PARTY_DATE, "Solo Intermediate", "INTERMEDIATE", actorUserId, 5);

  const assignment = await openPlayRotationService.proposeNextAssignment(PARTY_DATE, courtId, actorUserId);
  assert(assignment, "expected a proposed assignment for the party + 1 solo candidate");
  assert(assignment!.participants.length === 4, "assignment should have exactly 4 participants");

  const participantIds = assignment!.participants.map((p) => p.registrationId);

  for (const id of partyMemberIds) {
    assert(participantIds.includes(id), "every party member must be in the same assignment — a party is never split");
  }
  assert(participantIds.includes(soloId), "the closest-skill solo candidate should fill the party's 4th seat");
  assert(participantIds.length === 4, "party of 3 + 1 solo == 4");

  console.log("PASS: party of 3 stays together, matched on average skill");
}

async function testManualOverrideNeverOverwritten(courtA: string, courtB: string, actorUserId: string): Promise<void> {
  const ids: string[] = [];
  for (let i = 0; i < 8; i++) {
    ids.push(await checkInBackdated(MANUAL_OVERRIDE_DATE, `Player ${i}`, "INTERMEDIATE", actorUserId, i));
  }

  const manualPicks = ids.slice(0, 4);
  const manual = await openPlayRotationService.createManualAssignment(MANUAL_OVERRIDE_DATE, courtA, manualPicks, actorUserId);
  assert(manual.source === "MANUAL", "manual assignment should have source MANUAL");
  assert(manual.status === "PROPOSED", "manual assignment starts PROPOSED");
  assert(
    manual.participants.every((p) => manualPicks.includes(p.registrationId)),
    "manual assignment should contain exactly the staff-picked players",
  );

  const auto = await openPlayRotationService.proposeNextAssignment(MANUAL_OVERRIDE_DATE, courtB, actorUserId);
  assert(auto, "expected an auto-proposal for the second court from the remaining 4 waiting players");
  const autoIds = auto!.participants.map((p) => p.registrationId);
  for (const pickedId of manualPicks) {
    assert(!autoIds.includes(pickedId), "auto-proposal must never re-pick a player already in the manual assignment");
  }

  const manualAfter = await prisma.gameAssignment.findUniqueOrThrow({
    where: { id: manual.id },
    include: { participants: true },
  });
  assert(manualAfter.status === "PROPOSED", "the manual assignment itself must be untouched by the later auto-proposal");
  assert(manualAfter.participants.length === 4, "manual assignment's participants must be unchanged");

  console.log("PASS: manual override is never overwritten (or raided) by a later auto-proposal");
}

async function testCourtNeverIdleWithFourWaiting(courtId: string, actorUserId: string): Promise<void> {
  const threeIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    threeIds.push(await checkInBackdated(COURT_IDLE_DATE, `Idle Test ${i}`, "INTERMEDIATE", actorUserId, i));
  }

  const withThree = await openPlayRotationService.proposeNextAssignment(COURT_IDLE_DATE, courtId, actorUserId);
  assert(withThree === null, "with only 3 waiting players, no assignment should be proposed (correctly, not a false idle-avoidance)");

  const fourthId = await checkInBackdated(COURT_IDLE_DATE, "Idle Test 3", "INTERMEDIATE", actorUserId, 3);
  void fourthId;

  const withFour = await openPlayRotationService.proposeNextAssignment(COURT_IDLE_DATE, courtId, actorUserId);
  assert(withFour, "with 4 waiting players, a court must never sit idle — an assignment should be proposed");
  assert(withFour!.participants.length === 4, "assignment should include exactly 4 participants");

  console.log("PASS: a court never sits idle while 4+ players wait (and correctly stays idle at only 3)");
}

async function main() {
  await cleanUp();

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
  assert(courts.length >= 2, "expected at least 2 seeded courts for these tests");

  try {
    await testStarvationGuard(courts[0].id, owner.id);
    await testPartyAverageSkill(courts[0].id, owner.id);
    await testManualOverrideNeverOverwritten(courts[0].id, courts[1].id, owner.id);
    await testCourtNeverIdleWithFourWaiting(courts[0].id, owner.id);
  } finally {
    await cleanUp();
  }

  console.log("\nAll open-play rotation scenarios passed.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUp();
  process.exit(1);
});
