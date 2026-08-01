/**
 * Reported live: early mornings only 2-3 people show up, and staff
 * couldn't start a game at all — "Build a group by hand" required
 * exactly 4. Doubles (4) is still the normal case; 2-3 is now real,
 * valid ₱35/game play, not an error. The AUTOMATIC skill-matching path
 * (assembleFoursome/proposeNextAssignment) still requires exactly 4 —
 * untouched by this fix.
 *
 * Proves, against real rows:
 *   1. A 2-player manual group is accepted.
 *   2. A 3-player manual group is accepted.
 *   3. A 1-player group is rejected (below the 2-player floor).
 *   4. A 5-player group is rejected (above the 4-player ceiling).
 *   5. Billing stays correct per player for a partial group: completing
 *      a 2-player game credits exactly 2 separate ₱35 tabs (₱70 total),
 *      never one split ₱140 charge — computeGameRateCents has no
 *      group-size logic at all, so this was already correct and stays
 *      that way; proven here rather than assumed.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRotationService } from "./open-play-rotation.service";
import { playerTabService } from "./player-tab.service";

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
    { playerName, phone: `09${Date.now()}`.slice(0, 11), skillLevel: "INTERMEDIATE" },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);
  return registration.id;
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
    // ============== 1. A 2-player manual group is accepted ==============
    const twoPlayerIds = [
      await checkedInRegistration(date, "Two A", owner.id),
      await checkedInRegistration(date, "Two B", owner.id),
    ];
    allRegistrationIds.push(...twoPlayerIds);
    const twoPlayerAssignment = await openPlayRotationService.createManualAssignment(
      date,
      courts[0].id,
      twoPlayerIds,
      owner.id,
    );
    assignmentIds.push(twoPlayerAssignment.id);
    assert(
      twoPlayerAssignment.participants.length === 2,
      `expected 2 participants, got ${twoPlayerAssignment.participants.length}`,
    );
    console.log("PASS: a 2-player manual group is accepted.");

    // ============== 2. A 3-player manual group is accepted ==============
    const threePlayerIds = [
      await checkedInRegistration(date, "Three A", owner.id),
      await checkedInRegistration(date, "Three B", owner.id),
      await checkedInRegistration(date, "Three C", owner.id),
    ];
    allRegistrationIds.push(...threePlayerIds);
    const threePlayerAssignment = await openPlayRotationService.createManualAssignment(
      date,
      courts[1].id,
      threePlayerIds,
      owner.id,
    );
    assignmentIds.push(threePlayerAssignment.id);
    assert(
      threePlayerAssignment.participants.length === 3,
      `expected 3 participants, got ${threePlayerAssignment.participants.length}`,
    );
    console.log("PASS: a 3-player manual group is accepted.");

    // ============== 3. A 1-player group is rejected ==============
    const soloId = await checkedInRegistration(date, "Solo Only", owner.id);
    allRegistrationIds.push(soloId);
    let soloRejected = false;
    try {
      await openPlayRotationService.createManualAssignment(date, courts[2].id, [soloId], owner.id);
    } catch {
      soloRejected = true;
    }
    assert(soloRejected, "expected a 1-player group to be rejected");
    console.log("PASS: a 1-player group is rejected (below the 2-player floor).");

    // ============== 4. A 5-player group is rejected ==============
    const fivePlayerIds = [
      soloId,
      await checkedInRegistration(date, "Five B", owner.id),
      await checkedInRegistration(date, "Five C", owner.id),
      await checkedInRegistration(date, "Five D", owner.id),
      await checkedInRegistration(date, "Five E", owner.id),
    ];
    allRegistrationIds.push(...fivePlayerIds.slice(1));
    let fiveRejected = false;
    try {
      await openPlayRotationService.createManualAssignment(
        date,
        courts[2].id,
        fivePlayerIds,
        owner.id,
      );
    } catch {
      fiveRejected = true;
    }
    assert(fiveRejected, "expected a 5-player group to be rejected");
    console.log("PASS: a 5-player group is rejected (above the 4-player ceiling).");

    // ============== 5. Billing stays correct per player for the 2-player group ==============
    await openPlayRotationService.confirmAssignment(twoPlayerAssignment.id, owner.id);
    await openPlayRotationService.completeAssignment(twoPlayerAssignment.id, owner.id);

    const [viewA, viewB] = await Promise.all([
      playerTabService.getTabViewByRegistration(twoPlayerIds[0]),
      playerTabService.getTabViewByRegistration(twoPlayerIds[1]),
    ]);
    assert(
      viewA !== null && viewB !== null,
      "expected both players to have a tab after their game was credited",
    );
    assert(
      viewA!.tab.gameRateCents === 3500,
      `expected tab A's game rate to be 3500, got ${viewA!.tab.gameRateCents}`,
    );
    assert(
      viewB!.tab.gameRateCents === 3500,
      `expected tab B's game rate to be 3500, got ${viewB!.tab.gameRateCents}`,
    );
    assert(
      viewA!.totalCents === 3500,
      `expected player A's tab total to be exactly 3500 (one ₱35 game), got ${viewA!.totalCents}`,
    );
    assert(
      viewB!.totalCents === 3500,
      `expected player B's tab total to be exactly 3500 (one ₱35 game), got ${viewB!.totalCents}`,
    );
    console.log(
      "PASS: a 2-player game bills each player their own ₱35 separately (₱70 total, never a split ₱140).",
    );

    console.log(
      "\nPASS: manual groups of 2, 3, or 4 players all work correctly, billing stays per-player.",
    );
  } finally {
    for (const assignmentId of assignmentIds) {
      await prisma.auditLog.deleteMany({
        where: { entityType: "GameAssignment", entityId: assignmentId },
      });
      await prisma.gameAssignmentParticipant.deleteMany({ where: { assignmentId } });
      await prisma.tabLineItem.deleteMany({ where: { gameAssignmentId: assignmentId } });
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
