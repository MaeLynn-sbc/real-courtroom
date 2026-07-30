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
 *   5. A party's rotation turn starts when it becomes playable (last
 *      member's check-in), not when it started assembling (first
 *      member's check-in) — a solo who was playable the whole time must
 *      anchor before a party that finished checking in later, even if
 *      the party's first member arrived earlier. Fixes a leapfrog bug
 *      from an earlier "earliest member" version of this rule.
 *   6. "Two parties of 3, no solos, one free court" — a real deadlock
 *      (parties never split, so 3+3 can't combine into 4), not covered
 *      by the plain idle-at-3 case. The board must surface a named
 *      reason, not sit idle with no explanation.
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
const PARTY_LEAPFROG_DATE = new Date(2031, 0, 20); // Monday
const UNFILLABLE_DATE = new Date(2031, 0, 21); // Tuesday
const MOVE_QUEUE_DATE = new Date(2031, 0, 22); // Wednesday

const ALL_DATES = [
  STARVATION_DATE,
  PARTY_DATE,
  MANUAL_OVERRIDE_DATE,
  COURT_IDLE_DATE,
  PARTY_LEAPFROG_DATE,
  UNFILLABLE_DATE,
  MOVE_QUEUE_DATE,
];

async function cleanUp(): Promise<void> {
  // Phase 7: checkIn now also opens a PlayerTab (BUILD-SPEC.md §6/§9), and
  // completeAssignment credits GAME line items referencing GameAssignment
  // — must be cleared, in this order, before their referenced rows.
  const registrations = await prisma.openPlayNightRegistration.findMany({
    where: { date: { in: ALL_DATES } },
    select: { id: true },
  });
  const registrationIds = registrations.map((r) => r.id);
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: registrationIds } }, select: { id: true } });
  const tabIds = tabs.map((t) => t.id);
  await prisma.sale.deleteMany({ where: { playerTabId: { in: tabIds } } });
  await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.gameAssignmentParticipant.deleteMany({ where: { registrationId: { in: registrationIds } } });
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

// BUILD-SPEC.md §7 "Rotation queue order uses joinedQueueAt directly — the
// last member's check-in." Regression test for the leapfrog bug: an
// earlier version used the EARLIEST member's check-in as a party's
// rotation wait start, which let a party still assembling jump ahead of a
// solo player who was playable the whole time it waited.
//
// Skill levels are deliberately engineered (not just "party of 3 + 1
// solo," which would sum to the same 4 participants regardless of which
// unit anchors) so a wrong anchor choice produces an observably different,
// wrong outcome: if the party wrongly anchored, its skill-window search
// would reach for the skill-close Solo B and stop (seats filled) before
// ever widening to the skill-distant Solo A — silently excluding the
// longest-waiting player. Solo A must anchor first.
async function testPartyDoesNotLeapfrogSolo(courtId: string, actorUserId: string): Promise<void> {
  // "A solo who checked in at 7:10" — playable the whole time, waiting
  // longest. ADVANCED and far in skill from the party below, so a wrong
  // anchor choice would exclude rather than just reorder this player.
  const soloAId = await checkInBackdated(PARTY_LEAPFROG_DATE, "Solo A (checked in first)", "ADVANCED", actorUserId, 50);

  // "A party of 3 completes check-in at 8:00" — became playable much more
  // recently than Solo A, even though its first member may have arrived
  // earlier (irrelevant now — only the completing check-in counts).
  const partyId = `party-leapfrog-${Date.now()}`;
  const partyMemberIds = await registerAndCheckInParty(
    PARTY_LEAPFROG_DATE,
    partyId,
    [
      { playerName: "Party Member 1", skillLevel: "BEGINNER" },
      { playerName: "Party Member 2", skillLevel: "BEGINNER" },
      { playerName: "Party Member 3", skillLevel: "BEGINNER" },
    ],
    actorUserId,
    10,
  );

  // Skill-close bait: if the party wrongly anchored, this player would
  // get pulled in ahead of Solo A and the search would stop there.
  const soloBId = await checkInBackdated(PARTY_LEAPFROG_DATE, "Solo B (skill-close bait)", "BEGINNER", actorUserId, 2);

  const assignment = await openPlayRotationService.proposeNextAssignment(PARTY_LEAPFROG_DATE, courtId, actorUserId);
  assert(assignment, "expected a proposed assignment for Solo A + the party");

  const participantIds = assignment!.participants.map((p) => p.registrationId);
  assert(
    participantIds.includes(soloAId),
    "Solo A checked in first and was playable the whole time — must anchor, not be leapfrogged by a party that completed later",
  );
  for (const id of partyMemberIds) {
    assert(participantIds.includes(id), "the whole party must be in the assignment — never split");
  }
  assert(!participantIds.includes(soloBId), "Solo B (skill-close bait) should not have been reached — Solo A + the party already fill the court");
  assert(assignment!.skillSpread === 3, `expected skillSpread 3 (advanced=4 minus beginner=1), got ${assignment!.skillSpread}`);

  console.log("PASS: a party's rotation turn starts when it becomes playable, not when it started assembling — no leapfrog");
}

async function testUnfillableQueueIsSurfaced(courtId: string, actorUserId: string): Promise<void> {
  await registerAndCheckInParty(
    UNFILLABLE_DATE,
    `party-unfillable-a-${Date.now()}`,
    [
      { playerName: "Deadlock A1", skillLevel: "INTERMEDIATE" },
      { playerName: "Deadlock A2", skillLevel: "INTERMEDIATE" },
      { playerName: "Deadlock A3", skillLevel: "INTERMEDIATE" },
    ],
    actorUserId,
    20,
  );
  await registerAndCheckInParty(
    UNFILLABLE_DATE,
    `party-unfillable-b-${Date.now()}`,
    [
      { playerName: "Deadlock B1", skillLevel: "INTERMEDIATE" },
      { playerName: "Deadlock B2", skillLevel: "INTERMEDIATE" },
      { playerName: "Deadlock B3", skillLevel: "INTERMEDIATE" },
    ],
    actorUserId,
    10,
  );

  const proposal = await openPlayRotationService.proposeNextAssignment(UNFILLABLE_DATE, courtId, actorUserId);
  assert(proposal === null, "two parties of 3 with no solos cannot form a valid foursome — propose must return null");

  const board = await openPlayRotationService.getRotationBoardData(UNFILLABLE_DATE);
  assert(
    board.unfillableQueueReason !== null,
    "with a free court and 6 players waiting in two unsplittable parties, the board must surface a named reason instead of sitting idle silently",
  );
  assert(
    board.unfillableQueueReason!.includes("6 players"),
    `expected the reason to name the waiting count, got: ${board.unfillableQueueReason}`,
  );

  console.log("PASS: an unfillable queue (two parties of 3, no solos) is surfaced on the board, not silently idle");
}

// Queue reorder (reported live): a forming group short a fourth wants a
// specific, later-queued player — staff move that unit to sit right
// after the wanted player, and everyone between the old and new spot
// should advance automatically, for free.
async function testMoveQueueUnitAfter(actorUserId: string): Promise<void> {
  const aliceId = await checkInBackdated(MOVE_QUEUE_DATE, "Alice (moving)", "INTERMEDIATE", actorUserId, 40);
  const benId = await checkInBackdated(MOVE_QUEUE_DATE, "Ben (passed)", "INTERMEDIATE", actorUserId, 30);
  const carlaId = await checkInBackdated(MOVE_QUEUE_DATE, "Carla (passed)", "INTERMEDIATE", actorUserId, 20);
  const dexId = await checkInBackdated(MOVE_QUEUE_DATE, "Dex (target)", "INTERMEDIATE", actorUserId, 10);

  const before = await openPlayRotationService.getRotationBoardData(MOVE_QUEUE_DATE);
  const beforeOrder = before.waiting.map((u) => u.members[0].registrationId);
  assert(
    beforeOrder.indexOf(aliceId) < beforeOrder.indexOf(benId) &&
      beforeOrder.indexOf(benId) < beforeOrder.indexOf(carlaId) &&
      beforeOrder.indexOf(carlaId) < beforeOrder.indexOf(dexId),
    "expected join order Alice, Ben, Carla, Dex before the move",
  );

  await openPlayRotationService.moveQueueUnitAfter(MOVE_QUEUE_DATE, [aliceId], dexId, actorUserId);

  const after = await openPlayRotationService.getRotationBoardData(MOVE_QUEUE_DATE);
  const afterOrder = after.waiting.map((u) => u.members[0].registrationId);
  assert(
    afterOrder.indexOf(benId) < afterOrder.indexOf(carlaId) &&
      afterOrder.indexOf(carlaId) < afterOrder.indexOf(dexId) &&
      afterOrder.indexOf(dexId) < afterOrder.indexOf(aliceId),
    `expected Ben, Carla, Dex, Alice after moving Alice after Dex — got ${afterOrder.join(", ")}`,
  );

  console.log("PASS: moving a solo after a later player advances everyone passed, automatically");

  // Whole-party guard: selecting only part of a party must be rejected.
  const partyId = `party-move-${Date.now()}`;
  const partyMemberIds = await registerAndCheckInParty(
    MOVE_QUEUE_DATE,
    partyId,
    [
      { playerName: "Party Move 1", skillLevel: "BEGINNER" },
      { playerName: "Party Move 2", skillLevel: "BEGINNER" },
    ],
    actorUserId,
    5,
  );
  let partialPartyRejected = false;
  try {
    await openPlayRotationService.moveQueueUnitAfter(MOVE_QUEUE_DATE, [partyMemberIds[0]], dexId, actorUserId);
  } catch {
    partialPartyRejected = true;
  }
  assert(partialPartyRejected, "moving only part of a party must be rejected — a party moves together or not at all");

  // Self-target guard.
  let selfTargetRejected = false;
  try {
    await openPlayRotationService.moveQueueUnitAfter(MOVE_QUEUE_DATE, [benId], benId, actorUserId);
  } catch {
    selfTargetRejected = true;
  }
  assert(selfTargetRejected, "moving a unit to sit after itself must be rejected");

  // Not-currently-waiting guard — same invariant that already prevents
  // double-stacking: a player mid-assignment can't also be reordered in
  // the queue.
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
  const fillerIds = [
    await checkInBackdated(MOVE_QUEUE_DATE, "Filler 1", "INTERMEDIATE", actorUserId, 4),
    await checkInBackdated(MOVE_QUEUE_DATE, "Filler 2", "INTERMEDIATE", actorUserId, 3),
  ];
  await openPlayRotationService.createManualAssignment(
    MOVE_QUEUE_DATE,
    courts[0].id,
    [carlaId, dexId, ...fillerIds],
    actorUserId,
  );
  let playingPlayerRejected = false;
  try {
    await openPlayRotationService.moveQueueUnitAfter(MOVE_QUEUE_DATE, [benId], dexId, actorUserId);
  } catch {
    playingPlayerRejected = true;
  }
  assert(
    playingPlayerRejected,
    "a player already inside a proposed/active assignment can't be a move target — they're no longer WAITING",
  );

  console.log("PASS: whole-party, self-target, and not-currently-waiting guards all reject correctly");
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
    await testPartyDoesNotLeapfrogSolo(courts[0].id, owner.id);
    await testUnfillableQueueIsSurfaced(courts[0].id, owner.id);
    await testMoveQueueUnitAfter(owner.id);
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
