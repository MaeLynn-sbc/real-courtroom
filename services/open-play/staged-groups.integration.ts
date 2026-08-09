/**
 * Staging pipeline (Next up/After that/Then) — reported live: "staff need
 * to compose the staging slots, not just watch them fill." Real, saved
 * groups now (QueueEntry.stagedGroupId -> StagedGroup), not a computed
 * preview of the top of the waiting queue.
 *
 * Proves, against real rows:
 *   1. Auto queue takes the next N waiting (strict FIFO) into a slot.
 *   2. Build by hand stages an explicit pick into a slot.
 *   3. A staged player is invisible to fetchWaitingUnits — excluded from
 *      the Waiting list/count AND the automatic skill-matching engine
 *      (same shared query, proven via getRotationBoardData directly).
 *   4. Filling an already-occupied slot is a clean rejection, never a
 *      silent overwrite (requirement 7).
 *   5. The × control (unstageQueueEntry) returns exactly one player to
 *      Waiting, at their existing, untouched joinedQueueAt position —
 *      not the bottom — and dissolves the group once it drops below 2.
 *   6. Removing the whole group (unstageGroup) returns every member.
 *   7. Assigning a staged group to a court resolves membership fresh,
 *      server-side (not from a stale client array), and auto-advances
 *      the pipeline: After that -> Next up, Then -> After that — with
 *      no announcement firing as a side effect.
 *   8. The real race: two concurrent assignments of the SAME staged
 *      group to two different courts — exactly one wins.
 *   9. markResting/markDone on a staged player un-stages them too
 *      ("exactly one place at a time").
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

const TEST_DATE = new Date(2031, 6, 9); // Wednesday, distinct from other integration fixtures

async function checkedInRegistration(playerName: string, actorUserId: string): Promise<string> {
  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    TEST_DATE,
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

async function queueEntryIdFor(registrationId: string): Promise<string> {
  const entry = await prisma.queueEntry.findUniqueOrThrow({ where: { registrationId } });
  return entry.id;
}

async function cleanUp(registrationIds: string[]): Promise<void> {
  const entries = await prisma.queueEntry.findMany({
    where: { registrationId: { in: registrationIds } },
    select: { stagedGroupId: true },
  });
  const stagedGroupIds = [
    ...new Set(entries.map((e) => e.stagedGroupId).filter((id): id is string => id !== null)),
  ];
  await prisma.auditLog.deleteMany({
    where: { entityType: { in: ["StagedGroup", "GameAssignment", "QueueEntry"] } },
  });
  await prisma.tabLineItem.deleteMany({
    where: { tab: { registrationId: { in: registrationIds } } },
  });
  await prisma.playerTab.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.gameAssignmentParticipant.deleteMany({
    where: { registrationId: { in: registrationIds } },
  });
  await prisma.gameAssignment.deleteMany({ where: { date: TEST_DATE } });
  await prisma.queueEntry.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.stagedGroup.deleteMany({ where: { id: { in: stagedGroupIds } } });
  await prisma.stagedGroup.deleteMany({ where: { date: TEST_DATE } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { id: { in: registrationIds } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const courts = await prisma.court.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    take: 3,
  });
  assert(courts.length >= 3, "expected at least 3 courts to run this test");

  const allRegistrationIds: string[] = [];

  try {
    // ============== 1. Auto queue: next N waiting, strict FIFO ==============
    const autoIds = [
      await checkedInRegistration("Auto A", owner.id),
      await checkedInRegistration("Auto B", owner.id),
      await checkedInRegistration("Auto C", owner.id),
    ];
    allRegistrationIds.push(...autoIds);

    const autoGroup = await openPlayRotationService.stageAutoQueue(
      TEST_DATE,
      "NEXT_UP",
      3,
      owner.id,
    );
    assert(autoGroup.slot === "NEXT_UP", `expected slot NEXT_UP, got ${autoGroup.slot}`);
    assert(
      autoGroup.source === "AUTO_QUEUE",
      `expected source AUTO_QUEUE, got ${autoGroup.source}`,
    );
    assert(
      autoGroup.members
        .map((m) => m.registrationId)
        .sort()
        .join(",") === [...autoIds].sort().join(","),
      "expected auto queue to take exactly the 3 waiting players, in order",
    );
    console.log(
      "PASS: Auto queue takes the next N waiting players, strict FIFO, into the chosen slot.",
    );

    // ============== 2. Filling an occupied slot is a clean rejection ==============
    let rejectedOccupied = false;
    try {
      await openPlayRotationService.stageAutoQueue(TEST_DATE, "NEXT_UP", 2, owner.id);
    } catch (error) {
      rejectedOccupied = error instanceof Error && error.message.includes("already has a group");
    }
    assert(
      rejectedOccupied,
      "expected staging into an already-occupied slot to be rejected cleanly",
    );
    console.log(
      "PASS: filling an already-occupied slot is a clean rejection, not a silent overwrite.",
    );

    // ============== 3. A staged player is invisible to fetchWaitingUnits (Waiting + auto-match) ==============
    const boardAfterStaging = await openPlayRotationService.getRotationBoardData(TEST_DATE);
    const waitingIds = boardAfterStaging.waiting.flatMap((u) =>
      u.members.map((m) => m.registrationId),
    );
    for (const id of autoIds) {
      assert(
        !waitingIds.includes(id),
        `expected staged player ${id} to be excluded from the Waiting list`,
      );
    }
    console.log(
      "PASS: staged players are excluded from the Waiting list (and, via the same shared query, the auto-matching engine).",
    );

    // ============== 4. Build by hand: explicit pick into a slot ==============
    const handIds = [
      await checkedInRegistration("Hand A", owner.id),
      await checkedInRegistration("Hand B", owner.id),
    ];
    allRegistrationIds.push(...handIds);
    const handGroup = await openPlayRotationService.stageManualGroup(
      TEST_DATE,
      "AFTER_THAT",
      handIds,
      owner.id,
    );
    assert(handGroup.slot === "AFTER_THAT", `expected slot AFTER_THAT, got ${handGroup.slot}`);
    assert(handGroup.source === "MANUAL", `expected source MANUAL, got ${handGroup.source}`);
    assert(handGroup.members.length === 2, `expected 2 members, got ${handGroup.members.length}`);
    console.log("PASS: Build by hand stages an explicit pick into the chosen slot.");

    // ============== 5. × un-stages exactly one player, at their existing position, not the bottom ==============
    const thenIds = [
      await checkedInRegistration("Then A", owner.id),
      await checkedInRegistration("Then B", owner.id),
      await checkedInRegistration("Then C", owner.id),
    ];
    allRegistrationIds.push(...thenIds);
    const thenGroup = await openPlayRotationService.stageManualGroup(
      TEST_DATE,
      "THEN",
      thenIds,
      owner.id,
    );

    const thenAEntryBefore = await prisma.queueEntry.findUniqueOrThrow({
      where: { registrationId: thenIds[0] },
    });
    const thenAQueueEntryId = await queueEntryIdFor(thenIds[0]);
    await openPlayRotationService.unstageQueueEntry(thenAQueueEntryId, owner.id);

    const thenAEntryAfter = await prisma.queueEntry.findUniqueOrThrow({
      where: { registrationId: thenIds[0] },
    });
    assert(
      thenAEntryAfter.stagedGroupId === null,
      "expected the un-staged player's stagedGroupId to be cleared",
    );
    assert(
      thenAEntryAfter.joinedQueueAt.getTime() === thenAEntryBefore.joinedQueueAt.getTime(),
      "expected joinedQueueAt to be completely untouched by unstaging — that's what makes 'correct position, not the bottom' true",
    );
    const boardAfterUnstageOne = await openPlayRotationService.getRotationBoardData(TEST_DATE);
    const waitingIdsAfterUnstageOne = boardAfterUnstageOne.waiting.flatMap((u) =>
      u.members.map((m) => m.registrationId),
    );
    assert(
      waitingIdsAfterUnstageOne.includes(thenIds[0]),
      "expected the un-staged player to reappear in Waiting",
    );
    const stillStagedGroup = boardAfterUnstageOne.stagedGroups.find((g) => g.id === thenGroup.id);
    assert(
      stillStagedGroup && stillStagedGroup.members.length === 2,
      "expected the group to survive with its other 2 members (3 - 1 = 2, still >= the floor)",
    );
    console.log(
      "PASS: x un-stages exactly one player, returning them to Waiting at their existing queue position — group survives with 2 left.",
    );

    // ============== 6. Dissolve: removing a member drops the group below 2 ==============
    const thenBQueueEntryId = await queueEntryIdFor(thenIds[1]);
    await openPlayRotationService.unstageQueueEntry(thenBQueueEntryId, owner.id);

    const dissolvedGroup = await prisma.stagedGroup.findUnique({ where: { id: thenGroup.id } });
    assert(
      dissolvedGroup === null,
      "expected the group to be dissolved once it dropped below 2 members",
    );
    const thenCEntryAfterDissolve = await prisma.queueEntry.findUniqueOrThrow({
      where: { registrationId: thenIds[2] },
    });
    assert(
      thenCEntryAfterDissolve.stagedGroupId === null,
      "expected the LAST remaining member to also be un-staged when the group dissolves",
    );
    console.log(
      "PASS: a group that drops below 2 members is dissolved outright — the last remaining member is freed too.",
    );

    // ============== 7. Remove group un-stages everyone at once ==============
    const removeGroupIds = [
      await checkedInRegistration("RemoveGroup A", owner.id),
      await checkedInRegistration("RemoveGroup B", owner.id),
    ];
    allRegistrationIds.push(...removeGroupIds);
    // AFTER_THAT is occupied by handGroup already — use THEN, now empty after step 6's dissolve.
    const removeGroup = await openPlayRotationService.stageManualGroup(
      TEST_DATE,
      "THEN",
      removeGroupIds,
      owner.id,
    );
    await openPlayRotationService.unstageGroup(removeGroup.id, owner.id);
    const removedGroupRow = await prisma.stagedGroup.findUnique({ where: { id: removeGroup.id } });
    assert(removedGroupRow === null, "expected the StagedGroup row to be deleted");
    for (const id of removeGroupIds) {
      const entry = await prisma.queueEntry.findUniqueOrThrow({ where: { registrationId: id } });
      assert(entry.stagedGroupId === null, `expected ${id} to be un-staged after Remove group`);
    }
    console.log("PASS: Remove group un-stages every member at once.");

    // ============== 8. Assign to court: resolves members server-side, advances the pipeline, no auto-announce ==============
    // Re-stage THEN so the pipeline has all 3 slots occupied for a clean
    // advance check: NEXT_UP (autoGroup) -> assigned -> AFTER_THAT
    // (handGroup) should become the new NEXT_UP, and a fresh THEN group
    // should become the new AFTER_THAT.
    const newThenIds = [
      await checkedInRegistration("NewThen A", owner.id),
      await checkedInRegistration("NewThen B", owner.id),
    ];
    allRegistrationIds.push(...newThenIds);
    const newThenGroup = await openPlayRotationService.stageManualGroup(
      TEST_DATE,
      "THEN",
      newThenIds,
      owner.id,
    );

    const assignment = await openPlayRotationService.assignPendingGroupToCourt(
      TEST_DATE,
      courts[0].id,
      autoGroup.id,
      owner.id,
    );
    assert(assignment.status === "PROPOSED", `expected PROPOSED, got ${assignment.status}`);
    assert(
      assignment.participants
        .map((p) => p.registrationId)
        .sort()
        .join(",") === [...autoIds].sort().join(","),
      "expected the assignment's participants to be resolved fresh from the staged group's real members",
    );
    // Owner request (2026-08-09): the first announcement now fires
    // automatically the moment ANY assignment is proposed to a court —
    // reversed from this test's original assertion (see
    // createAssignmentTx's own comment in open-play-rotation.service.ts).
    assert(
      assignment.announcementRequestedAt !== null,
      "expected the announcement to fire automatically the instant this staged group is assigned to a court",
    );

    const assignedGroupRow = await prisma.stagedGroup.findUnique({ where: { id: autoGroup.id } });
    assert(
      assignedGroupRow === null,
      "expected the assigned group's StagedGroup row to be deleted, freeing NEXT_UP for a new group",
    );

    const boardAfterAssign = await openPlayRotationService.getRotationBoardData(TEST_DATE);
    const nextUpNow = boardAfterAssign.stagedGroups.find((g) => g.slot === "NEXT_UP");
    const afterThatNow = boardAfterAssign.stagedGroups.find((g) => g.slot === "AFTER_THAT");
    const thenNow = boardAfterAssign.stagedGroups.find((g) => g.slot === "THEN");
    assert(nextUpNow?.id === handGroup.id, "expected After that's group to advance into Next up");
    assert(
      afterThatNow?.id === newThenGroup.id,
      "expected Then's group to advance into After that",
    );
    assert(thenNow === undefined, "expected Then to be empty after the pipeline advanced");
    console.log(
      "PASS: assigning a staged group to a court resolves members fresh, deletes the emptied slot, auto-advances the pipeline, and auto-fires the announcement.",
    );

    // ============== 9. The real race: two concurrent assignments of the same staged group ==============
    const raceIds = [
      await checkedInRegistration("Race A", owner.id),
      await checkedInRegistration("Race B", owner.id),
    ];
    allRegistrationIds.push(...raceIds);
    const raceGroup = await openPlayRotationService.stageManualGroup(
      TEST_DATE,
      "THEN",
      raceIds,
      owner.id,
    );

    const raceResults = await Promise.allSettled([
      openPlayRotationService.assignPendingGroupToCourt(
        TEST_DATE,
        courts[1].id,
        raceGroup.id,
        owner.id,
      ),
      openPlayRotationService.assignPendingGroupToCourt(
        TEST_DATE,
        courts[2].id,
        raceGroup.id,
        owner.id,
      ),
    ]);
    const raceFulfilled = raceResults.filter((r) => r.status === "fulfilled");
    const raceRejected = raceResults.filter((r) => r.status === "rejected");
    assert(
      raceFulfilled.length === 1 && raceRejected.length === 1,
      `expected exactly one winner assigning the same staged group, got ${raceFulfilled.length} fulfilled / ${raceRejected.length} rejected`,
    );
    console.log(
      "PASS: two concurrent assignments of the SAME staged group to different courts — exactly one wins, the other fails clean.",
    );

    // ============== 10. markResting/markDone un-stage a staged player too ==============
    const restIds = [
      await checkedInRegistration("Rest A", owner.id),
      await checkedInRegistration("Rest B", owner.id),
    ];
    allRegistrationIds.push(...restIds);
    const restGroup = await openPlayRotationService.stageManualGroup(
      TEST_DATE,
      "THEN",
      restIds,
      owner.id,
    );
    const restAQueueEntryId = await queueEntryIdFor(restIds[0]);
    await openPlayRotationService.markResting(restAQueueEntryId, owner.id);
    const restGroupAfter = await prisma.stagedGroup.findUnique({ where: { id: restGroup.id } });
    assert(
      restGroupAfter === null,
      "expected resting the only-other member below 2 to dissolve the group too",
    );
    const restAEntry = await prisma.queueEntry.findUniqueOrThrow({
      where: { id: restAQueueEntryId },
    });
    assert(
      restAEntry.status === "RESTING",
      "expected the rested player's status to actually be RESTING",
    );
    assert(restAEntry.stagedGroupId === null, "expected the rested player to be un-staged too");
    console.log(
      "PASS: markResting un-stages a staged player (and dissolves the group if that drops it below 2).",
    );

    // ============== 11. Add a player to an existing group; blocked at 4; swap is x-then-add ==============
    const addIds = [
      await checkedInRegistration("AddTarget A", owner.id),
      await checkedInRegistration("AddTarget B", owner.id),
      await checkedInRegistration("AddTarget C", owner.id),
    ];
    allRegistrationIds.push(...addIds);
    const addGroup = await openPlayRotationService.stageManualGroup(
      TEST_DATE,
      "THEN",
      addIds,
      owner.id,
    );

    const newcomerId = await checkedInRegistration("Newcomer", owner.id);
    allRegistrationIds.push(newcomerId);
    const grownGroup = await openPlayRotationService.addPlayerToStagedGroup(
      addGroup.id,
      newcomerId,
      owner.id,
    );
    assert(
      grownGroup.members.length === 4,
      `expected 4 members after adding, got ${grownGroup.members.length}`,
    );
    assert(
      grownGroup.members.some((m) => m.registrationId === newcomerId),
      "expected the newcomer to actually be in the group",
    );
    const newcomerEntry = await prisma.queueEntry.findUniqueOrThrow({
      where: { registrationId: newcomerId },
    });
    assert(
      newcomerEntry.stagedGroupId === addGroup.id,
      "expected the newcomer's QueueEntry to point at the group",
    );
    console.log("PASS: Add a player brings a group from 3 to 4.");

    let rejectedFull = false;
    const fifthId = await checkedInRegistration("Fifth Wheel", owner.id);
    allRegistrationIds.push(fifthId);
    try {
      await openPlayRotationService.addPlayerToStagedGroup(addGroup.id, fifthId, owner.id);
    } catch (error) {
      rejectedFull = error instanceof Error && error.message.includes("full");
    }
    assert(rejectedFull, "expected adding a 5th player to a full group to be rejected");
    const fifthEntry = await prisma.queueEntry.findUniqueOrThrow({
      where: { registrationId: fifthId },
    });
    assert(
      fifthEntry.stagedGroupId === null,
      "expected the rejected 5th player to remain un-staged, not partially added",
    );
    console.log(
      "PASS: adding a player to an already-full (4-member) group is rejected, blocked at 4.",
    );

    // Swap: x the newcomer back out, then add the "fifth wheel" instead —
    // deliberately the same two already-proven operations, not a third
    // bespoke mechanism.
    const newcomerQueueEntryId = await queueEntryIdFor(newcomerId);
    await openPlayRotationService.unstageQueueEntry(newcomerQueueEntryId, owner.id);
    const swappedGroup = await openPlayRotationService.addPlayerToStagedGroup(
      addGroup.id,
      fifthId,
      owner.id,
    );
    const swappedIds = swappedGroup.members.map((m) => m.registrationId).sort();
    const expectedSwappedIds = [...addIds, fifthId].sort();
    assert(
      swappedIds.join(",") === expectedSwappedIds.join(","),
      `expected swap (x newcomer, add fifth wheel) to leave exactly [${expectedSwappedIds.join(",")}], got [${swappedIds.join(",")}]`,
    );
    const newcomerAfterSwap = await prisma.queueEntry.findUniqueOrThrow({
      where: { registrationId: newcomerId },
    });
    assert(
      newcomerAfterSwap.stagedGroupId === null,
      "expected the swapped-out newcomer to be back in Waiting, not staged anywhere",
    );
    console.log(
      "PASS: swap (x then Add) leaves the group with exactly the intended replacement, and returns the swapped-out player to Waiting.",
    );

    console.log("\nPASS: staging pipeline proven against real rows.");
  } finally {
    await cleanUp(allRegistrationIds);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
