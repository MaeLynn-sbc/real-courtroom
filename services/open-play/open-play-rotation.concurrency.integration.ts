/**
 * Hardening phase (BUILD-SPEC.md §0 process rule — a failing test before
 * every fix, then confirmed passing after). Covers items 1 and 2 of the
 * six-item concurrency audit (BUILD-SPEC.md §15):
 *
 *   1. proposeNextAssignment — the waiting-players read and the
 *      assignment-creating write ran in separate transactions/queries.
 *      Two concurrent proposals (even for two different courts) could
 *      read the same waiting pool before either wrote, letting the same
 *      registration end up a participant in two simultaneous
 *      GameAssignments.
 *   2. cancelAssignment — did not take the same FOR UPDATE lock
 *      completeAssignment does. A concurrent cancelAssignment could
 *      block on that lock, then overwrite a freshly-committed DONE back
 *      to CANCELLED using its own stale pre-lock read — after the game
 *      was already credited and billed.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRotationService } from "./open-play-rotation.service";

// Committed, not a one-off investigation delay: cancelAssignmentTx's
// FOR UPDATE lock is only proven load-bearing if a concurrent
// completeAssignment gets real wall-clock time to run to completion while
// cancel holds that lock. Without this, the two independent async calls'
// natural start/connection-acquisition jitter is wide enough that the
// unlocked (regressed) version of the code was measured passing this test
// 19/19 times across two runs — a test that cannot fail is not a test.
// Harmless when the lock is present: cancel already holds exclusive access
// by the time this fires, so a concurrent completeAssignment is blocked on
// the DB lock itself, not on this delay.
const RACE_DELAY_MS = 400;
const raceDelayHook = () => new Promise<void>((resolve) => setTimeout(resolve, RACE_DELAY_MS));

const DOUBLE_BOOK_DATE = new Date(2031, 1, 11); // Tuesday
const CANCEL_RACE_DATE = new Date(2031, 1, 12); // Wednesday

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUpDate(date: Date): Promise<void> {
  const registrations = await prisma.openPlayNightRegistration.findMany({ where: { date }, select: { id: true } });
  const ids = registrations.map((r) => r.id);
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
  const tabIds = tabs.map((t) => t.id);
  await prisma.sale.deleteMany({ where: { playerTabId: { in: tabIds } } });
  await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.recentPairing.deleteMany({ where: { date } });
  await prisma.gameAssignmentParticipant.deleteMany({ where: { registrationId: { in: ids } } });
  await prisma.gameAssignment.deleteMany({ where: { date } });
  await prisma.queueEntry.deleteMany({ where: { date } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { date } });
}

async function cleanUp(): Promise<void> {
  await cleanUpDate(DOUBLE_BOOK_DATE);
  await cleanUpDate(CANCEL_RACE_DATE);
}

// Fixture: exactly 5 waiting solo players, two different courts, one
// proposeNextAssignment call fired at each concurrently. Each assignment
// needs 4 of the 5 — if both succeed, they'd need 8 distinct players from
// a pool of 5, which is only possible if the same player was double-booked
// onto both courts. Sharp on purpose: any overlap at all is corruption.
async function testProposalsNeverDoubleBook(courts: { id: string }[], actorUserId: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const r = await openPlayRegistrationService.registerWeeknightWalkIn(
      DOUBLE_BOOK_DATE,
      { playerName: `Double Book ${i}`, phone: `09900000${i}`, skillLevel: "INTERMEDIATE" },
      actorUserId,
    );
    await openPlayCheckinService.checkIn(r.id, actorUserId);
  }

  console.log("  Firing 2 concurrent proposeNextAssignment calls for 2 different courts, pool of 5...");
  const results = await Promise.allSettled([
    openPlayRotationService.proposeNextAssignment(DOUBLE_BOOK_DATE, courts[0].id, actorUserId),
    openPlayRotationService.proposeNextAssignment(DOUBLE_BOOK_DATE, courts[1].id, actorUserId),
  ]);

  const fulfilledAssignments = results
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof openPlayRotationService.proposeNextAssignment>>> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((v): v is NonNullable<typeof v> => v !== null);

  console.log(`  Assignments created: ${fulfilledAssignments.length}`);

  const allParticipantIds = fulfilledAssignments.flatMap((a) => a.participants.map((p) => p.registrationId));
  const uniqueParticipantIds = new Set(allParticipantIds);

  assert(
    allParticipantIds.length === uniqueParticipantIds.size,
    `expected every participant across all created assignments to be distinct — got ${allParticipantIds.length} total, ` +
      `${uniqueParticipantIds.size} unique. A registration appearing twice means it was double-booked onto two courts at once.`,
  );

  if (fulfilledAssignments.length === 2) {
    assert(
      uniqueParticipantIds.size === 8,
      `two successful assignments from a pool of only 5 players must be impossible without double-booking — got ${uniqueParticipantIds.size} unique participants`,
    );
  }

  console.log("PASS: concurrent proposals for different courts never double-book the same player");
}

// Fixture: one ACTIVE assignment, completeAssignment and cancelAssignment
// fired concurrently at it. The corruption isn't "which one wins" — either
// outcome (DONE or CANCELLED) is legitimate depending on timing. The
// corruption is a CANCELLED assignment that was ALSO credited/billed —
// money charged for a game the record says never happened.
async function testCancelNeverOverwritesADoneCredit(courtId: string, actorUserId: string): Promise<void> {
  const registrationIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await openPlayRegistrationService.registerWeeknightWalkIn(
      CANCEL_RACE_DATE,
      { playerName: `Cancel Race ${i}`, phone: `09910000${i}`, skillLevel: "INTERMEDIATE" },
      actorUserId,
    );
    await openPlayCheckinService.checkIn(r.id, actorUserId);
    registrationIds.push(r.id);
  }

  const assignment = await prisma.gameAssignment.create({
    data: { courtId, date: CANCEL_RACE_DATE, skillSpread: 0, source: "AUTO", status: "ACTIVE", startedAt: new Date() },
  });
  await Promise.all(
    registrationIds.map((registrationId) =>
      prisma.gameAssignmentParticipant.create({ data: { assignmentId: assignment.id, registrationId } }),
    ),
  );
  await prisma.queueEntry.updateMany({ where: { registrationId: { in: registrationIds } }, data: { status: "PLAYING" } });

  console.log("  Firing completeAssignment and cancelAssignment concurrently against one ACTIVE assignment...");
  await Promise.allSettled([
    openPlayRotationService.completeAssignment(assignment.id, actorUserId),
    openPlayRotationService.cancelAssignment(assignment.id, actorUserId, raceDelayHook),
  ]);

  const finalAssignment = await prisma.gameAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
  const creditCount = await prisma.tabLineItem.count({ where: { gameAssignmentId: assignment.id, type: "GAME" } });
  console.log(`  Final status: ${finalAssignment.status}, GAME credits: ${creditCount}`);

  if (finalAssignment.status === "CANCELLED") {
    assert(creditCount === 0, `a CANCELLED assignment must never have GAME credits — found ${creditCount}. Money was charged for a game the record says was cancelled.`);
  } else if (finalAssignment.status === "DONE") {
    assert(creditCount === 4, `a DONE assignment must have exactly 4 GAME credits (one per participant) — found ${creditCount}`);
  } else {
    assert(false, `expected the assignment to end DONE or CANCELLED, got ${finalAssignment.status}`);
  }

  console.log("PASS: cancelAssignment never overwrites a completed, credited game back to CANCELLED");
}

async function main(): Promise<void> {
  await cleanUp();
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
  assert(courts.length >= 2, "expected at least 2 seeded courts");

  try {
    await testProposalsNeverDoubleBook(courts, owner.id);
    await testCancelNeverOverwritesADoneCredit(courts[0].id, owner.id);
  } finally {
    await cleanUp();
  }

  console.log("\nAll rotation-service concurrency scenarios passed.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUp().catch(() => undefined);
  process.exit(1);
});
