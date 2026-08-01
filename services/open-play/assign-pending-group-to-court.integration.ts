/**
 * "Put the action where the group is" — a court dropdown + Assign button on
 * each pending group (Next up/After that/Then), so staff don't have to
 * scroll up to a court card. Deliberately NOT built on createManualAssignment's
 * "manual override" semantics (cancel-and-replace any PROPOSED game already
 * on the chosen court) — this control only ever offers VACANT courts, so an
 * occupied court showing up here can only mean a race: another staff
 * member's action landed in the gap between this page's last poll and this
 * click. That must fail clean, not silently cancel their work.
 *
 * Proves, against real rows:
 *   1. Assigning to a genuinely vacant court succeeds.
 *   2. Assigning to a court that already has an ACTIVE game is rejected —
 *      the existing game is left completely untouched.
 *   3. Assigning to a court that already has a PROPOSED game is rejected
 *      too (unlike createManualAssignment, which would cancel it) — the
 *      existing proposal survives.
 *   4. The real race: two concurrent calls targeting the same initially-
 *      vacant court. Exactly one succeeds; the other fails cleanly with a
 *      clear message. Only one GameAssignment ever lands on that court.
 *   5. A player who's no longer WAITING (already mid-game elsewhere) is
 *      rejected with their name in the message, not silently pulled.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRotationService } from "./open-play-rotation.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function checkedInRegistration(
  date: Date,
  playerName: string,
  actorUserId: string,
): Promise<string> {
  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    date,
    {
      playerName,
      phone: `09${Date.now()}${Math.random()}`.replace(/\D/g, "").slice(0, 11),
      skillLevel: "INTERMEDIATE",
    },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);
  return registration.id;
}

async function pair(date: Date, prefix: string, actorUserId: string): Promise<string[]> {
  return [
    await checkedInRegistration(date, `${prefix} A`, actorUserId),
    await checkedInRegistration(date, `${prefix} B`, actorUserId),
  ];
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, take: 3 });
  assert(courts.length >= 3, "expected at least 3 courts to run this test");

  const date = new Date();
  date.setDate(date.getDate() + ((2 - date.getDay() + 7) % 7 || 7));
  date.setHours(0, 0, 0, 0);

  const allRegistrationIds: string[] = [];
  const assignmentIds: string[] = [];

  try {
    // ============== 1. Assigning to a vacant court succeeds ==============
    const vacantIds = await pair(date, "Vacant", owner.id);
    allRegistrationIds.push(...vacantIds);
    const vacantAssignment = await openPlayRotationService.assignPendingGroupToCourt(
      date,
      courts[0].id,
      vacantIds,
      owner.id,
    );
    assignmentIds.push(vacantAssignment.id);
    assert(vacantAssignment.status === "PROPOSED", "expected the new assignment to be PROPOSED");
    assert(
      vacantAssignment.participants.length === 2,
      `expected 2 participants, got ${vacantAssignment.participants.length}`,
    );
    console.log("PASS: assigning a pending group to a genuinely vacant court succeeds.");

    // ============== 2. Rejected when the court already has an ACTIVE game ==============
    const activeCourtIds = await pair(date, "ActiveIncumbent", owner.id);
    allRegistrationIds.push(...activeCourtIds);
    const activeIncumbent = await openPlayRotationService.createManualAssignment(
      date,
      courts[1].id,
      activeCourtIds,
      owner.id,
    );
    assignmentIds.push(activeIncumbent.id);
    await openPlayRotationService.confirmAssignment(activeIncumbent.id, owner.id);

    const challengerIds = await pair(date, "ActiveChallenger", owner.id);
    allRegistrationIds.push(...challengerIds);
    let rejectedOnActive = false;
    let rejectionMessage = "";
    try {
      await openPlayRotationService.assignPendingGroupToCourt(
        date,
        courts[1].id,
        challengerIds,
        owner.id,
      );
    } catch (error) {
      rejectedOnActive = true;
      rejectionMessage = error instanceof Error ? error.message : "";
    }
    assert(rejectedOnActive, "expected assignment to a court with an ACTIVE game to be rejected");
    assert(
      rejectionMessage.toLowerCase().includes("court"),
      `expected a clear court-occupied message, got: ${rejectionMessage}`,
    );
    const incumbentAfter = await prisma.gameAssignment.findUniqueOrThrow({
      where: { id: activeIncumbent.id },
    });
    assert(
      incumbentAfter.status === "ACTIVE",
      "expected the existing ACTIVE game to be left completely untouched",
    );
    console.log(
      "PASS: assigning to a court with a running game is rejected — the running game is untouched.",
    );

    // ============== 3. Rejected when the court already has a PROPOSED game ==============
    const proposedCourtIds = await pair(date, "ProposedIncumbent", owner.id);
    allRegistrationIds.push(...proposedCourtIds);
    const proposedIncumbent = await openPlayRotationService.createManualAssignment(
      date,
      courts[2].id,
      proposedCourtIds,
      owner.id,
    );
    assignmentIds.push(proposedIncumbent.id);

    const proposedChallengerIds = await pair(date, "ProposedChallenger", owner.id);
    allRegistrationIds.push(...proposedChallengerIds);
    let rejectedOnProposed = false;
    try {
      await openPlayRotationService.assignPendingGroupToCourt(
        date,
        courts[2].id,
        proposedChallengerIds,
        owner.id,
      );
    } catch {
      rejectedOnProposed = true;
    }
    assert(
      rejectedOnProposed,
      "expected assignment to a court with a PROPOSED game to be rejected, unlike createManualAssignment's override behavior",
    );
    const proposedIncumbentAfter = await prisma.gameAssignment.findUniqueOrThrow({
      where: { id: proposedIncumbent.id },
    });
    assert(
      proposedIncumbentAfter.status === "PROPOSED",
      "expected the existing PROPOSED game to survive, not be cancelled",
    );
    console.log(
      "PASS: assigning to a court with a pending proposal is rejected — the proposal survives (no silent cancel-and-replace).",
    );

    // ============== 4. The real race: two concurrent calls, same vacant court ==============
    const raceCourtId = courts[0].id;
    // court-1 (courts[0]) is occupied by the step-1 PROPOSED assignment —
    // clear it first so this court is genuinely vacant again for the race.
    await openPlayRotationService.cancelAssignment(vacantAssignment.id, owner.id);

    const raceGroupOneIds = await pair(date, "RaceOne", owner.id);
    const raceGroupTwoIds = await pair(date, "RaceTwo", owner.id);
    allRegistrationIds.push(...raceGroupOneIds, ...raceGroupTwoIds);

    const raceResults = await Promise.allSettled([
      openPlayRotationService.assignPendingGroupToCourt(
        date,
        raceCourtId,
        raceGroupOneIds,
        owner.id,
      ),
      openPlayRotationService.assignPendingGroupToCourt(
        date,
        raceCourtId,
        raceGroupTwoIds,
        owner.id,
      ),
    ]);
    const raceFulfilled = raceResults.filter((r) => r.status === "fulfilled");
    const raceRejected = raceResults.filter((r) => r.status === "rejected");
    assert(
      raceFulfilled.length === 1 && raceRejected.length === 1,
      `expected exactly one winner and one clean failure in the race, got ${raceFulfilled.length} fulfilled / ${raceRejected.length} rejected`,
    );
    if (raceFulfilled[0].status === "fulfilled") {
      assignmentIds.push(raceFulfilled[0].value.id);
    }
    const courtRowsAfterRace = await prisma.gameAssignment.findMany({
      where: { courtId: raceCourtId, date, status: { in: ["ACTIVE", "PROPOSED"] } },
    });
    assert(
      courtRowsAfterRace.length === 1,
      `expected exactly one live assignment on the raced court, found ${courtRowsAfterRace.length}`,
    );
    console.log(
      "PASS: two concurrent assignments to the same vacant court — exactly one wins, the other fails clean, no double-booked court.",
    );

    // ============== 5. Rejected when a player is no longer WAITING ==============
    const midGamePlayerIds = await pair(date, "MidGame", owner.id);
    allRegistrationIds.push(...midGamePlayerIds);
    const midGameAssignment = await openPlayRotationService.createManualAssignment(
      date,
      courts[1].id === raceCourtId ? courts[2].id : courts[1].id,
      midGamePlayerIds,
      owner.id,
    );
    assignmentIds.push(midGameAssignment.id);
    // midGamePlayerIds[0] is now PLAYING (proposed, not confirmed) — trying
    // to also assign them to a different court via THIS control must fail,
    // not silently pull them off their current group. Free up step 3's
    // court first (still PROPOSED and never resolved) so this step tests
    // the not-waiting guard specifically, not just another occupied court.
    await openPlayRotationService.cancelAssignment(proposedIncumbent.id, owner.id);
    const freeCourtForStep5 = courts.find(
      (c) => c.id !== raceCourtId && c.id !== midGameAssignment.courtId,
    );
    assert(freeCourtForStep5, "expected a third free court for step 5");
    const otherPlayerId = await checkedInRegistration(date, "MidGame Partner", owner.id);
    allRegistrationIds.push(otherPlayerId);

    let rejectedOnNotWaiting = false;
    let notWaitingMessage = "";
    try {
      await openPlayRotationService.assignPendingGroupToCourt(
        date,
        freeCourtForStep5!.id,
        [midGamePlayerIds[0], otherPlayerId],
        owner.id,
      );
    } catch (error) {
      rejectedOnNotWaiting = true;
      notWaitingMessage = error instanceof Error ? error.message : "";
    }
    assert(rejectedOnNotWaiting, "expected assignment of an already-PLAYING player to be rejected");
    assert(
      notWaitingMessage.includes("MidGame A"),
      `expected the rejection message to name the player, got: ${notWaitingMessage}`,
    );
    console.log(
      "PASS: assigning a player who's no longer waiting is rejected, naming them — not silently pulled from their current group.",
    );

    console.log("\nPASS: assign-pending-group-to-court proven against real rows.");
  } finally {
    for (const assignmentId of assignmentIds) {
      await prisma.auditLog.deleteMany({
        where: { entityType: "GameAssignment", entityId: assignmentId },
      });
      await prisma.gameAssignmentParticipant.deleteMany({ where: { assignmentId } });
      await prisma.gameAssignment.deleteMany({ where: { id: assignmentId } });
    }
    await prisma.playerTab.deleteMany({ where: { registrationId: { in: allRegistrationIds } } });
    await prisma.queueEntry.deleteMany({ where: { registrationId: { in: allRegistrationIds } } });
    await prisma.auditLog.deleteMany({
      where: { entityType: "OpenPlayNightRegistration", entityId: { in: allRegistrationIds } },
    });
    await prisma.openPlayNightRegistration.deleteMany({
      where: { id: { in: allRegistrationIds } },
    });
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
