/**
 * Practice mode (owner, 2026-09-17): the real rotation on sample names,
 * shown on /rtv while the switch is on — and NEVER in sales.
 *
 * Proves, against real rows:
 *  1. A practice player lands straight in the practice queue, with no
 *     Player row and no tab.
 *  2. A full practice game (staged -> court -> started -> finished)
 *     creates no tab, no tab charge and no sale.
 *  3. The real paid paths refuse practice: no tab can open for a
 *     practice registration, and a real walk-in can't use the date.
 *  4. The display switch: /rtv data is practice only when asked.
 *  5. Clear practice removes every practice row and nothing else.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { practiceDate } from "../../lib/practice";
import { prisma } from "../../lib/prisma";
import { displayService } from "../display/display.service";
import { settingsService } from "../settings/settings.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRotationService } from "./open-play-rotation.service";
import { playerTabService } from "./player-tab.service";
import { practiceService } from "./practice.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null, status: "ACTIVE" }, orderBy: { name: "asc" } });
  const date = practiceDate();
  const takeoverBefore = await settingsService.getPracticeTakeoverRtv();
  await practiceService.clearPractice(owner.id);
  const salesBefore = await prisma.sale.count();
  const playersBefore = await prisma.player.count();

  try {
    // 1. Four sample names into the practice queue.
    const names = ["Practice Ana", "Practice Ben", "Practice Cai", "Practice Dee"];
    const regs = [];
    for (const [i, playerName] of names.entries()) {
      regs.push(
        await practiceService.addPracticePlayer(
          { playerName, skillLevel: i < 2 ? "NOVICE" : "INTERMEDIATE" },
          owner.id,
        ),
      );
    }
    assert((await prisma.player.count()) === playersBefore, "practice names never create a Player row");
    const board = await openPlayRotationService.getRotationBoardData(date);
    const waitingIds = board.waiting.flatMap((u) => u.members.map((m) => m.registrationId));
    assert(regs.every((r) => waitingIds.includes(r.id)), "every practice name is waiting in the practice line");
    assert((await prisma.playerTab.count({ where: { registrationId: { in: regs.map((r) => r.id) } } })) === 0, "no tab is opened");
    console.log("PASS: practice players go straight into the practice line, with no Player row and no tab.");

    // 2. Stage them, put them on a court, start and finish the game.
    const staged = await openPlayRotationService.stageManualGroup(date, "NEXT_UP", regs.map((r) => r.id), owner.id);
    const assignment = await openPlayRotationService.assignPendingGroupToCourt(date, court.id, staged.id, owner.id);
    await openPlayRotationService.confirmAssignment(assignment.id, owner.id);
    const done = await openPlayRotationService.completeAssignment(assignment.id, owner.id);
    assert(done.status === "DONE", "the practice game finishes normally");
    assert((await prisma.playerTab.count({ where: { registrationId: { in: regs.map((r) => r.id) } } })) === 0, "a finished practice game opens no tab");
    assert((await prisma.tabLineItem.count({ where: { gameAssignmentId: assignment.id } })) === 0, "a finished practice game is never billed");
    assert(
      (await prisma.sale.count({ where: { openPlayNightRegistrationId: { in: regs.map((r) => r.id) } } })) === 0,
      "no sale is linked to a practice player",
    );
    assert((await prisma.sale.count()) === salesBefore, "no sale was created at all");
    console.log("PASS: a full practice game (staged, on court, started, finished) bills nothing and records no sale.");

    // Mock settle: the finished game appears on each player's practice
    // bill, with court and time, without creating anything.
    const bills = await practiceService.getPracticeBills();
    assert(bills.length === 4, `four practice bills, got ${bills.length}`);
    assert(
      bills.every((b) => b.items.length === 1 && b.items[0].description.startsWith(`OP · ${court.name} · `) && b.totalCents > 0),
      `each bill lists the game with court and time, got ${JSON.stringify(bills[0])}`,
    );
    assert((await prisma.sale.count()) === salesBefore, "reading practice bills creates no sale");
    const practiceBoard = await openPlayRotationService.getRotationBoardData(date);
    assert(practiceBoard.courts.every((c) => !c.booked), "real bookings never mark a practice court booked");
    console.log("PASS: practice bills itemise finished games; practice courts are never blocked by real bookings.");

    // 3. The paid paths refuse practice outright.
    let tabRefused = false;
    try {
      await playerTabService.getOrCreateTab(regs[0].id, owner.id);
    } catch {
      tabRefused = true;
    }
    assert(tabRefused, "a tab can never open for a practice registration");
    let walkInRefused = false;
    try {
      await openPlayRegistrationService.registerWeeknightWalkIn(date, { playerName: "Real Walkin", phone: "1", skillLevel: "NOVICE" }, owner.id);
    } catch {
      walkInRefused = true;
    }
    assert(walkInRefused, "a real walk-in can't be registered on the practice date");
    console.log("PASS: the tab and walk-in paths refuse the practice date.");

    // 4. The TV only shows practice when asked.
    const practiceFrame = await displayService.getDisplayData({ practice: true });
    const liveFrame = await displayService.getDisplayData();
    assert(practiceFrame.practice === true && liveFrame.practice === false, "the frame says whether it is practice");
    const practiceNames = [...practiceFrame.courts.flatMap((c) => c.players.map((p) => p.name)), ...practiceFrame.queue];
    const liveNames = [...liveFrame.courts.flatMap((c) => c.players.map((p) => p.name)), ...liveFrame.queue];
    assert(practiceNames.some((n) => n.startsWith("Practice")), "the practice frame shows practice names");
    assert(!liveNames.some((n) => n.startsWith("Practice")), "the live frame never shows practice names");
    await settingsService.setPracticeTakeoverRtv(true, owner.id);
    assert(await settingsService.getPracticeTakeoverRtv(), "the /rtv takeover switch turns on");
    console.log("PASS: /rtv data is practice only while the switch is on; live data never includes practice.");

    // 5. Sample players: 10 per skill level, and pressing twice adds none.
    await practiceService.clearPractice(owner.id);
    const first = await practiceService.addSamplePlayers(owner.id);
    const again = await practiceService.addSamplePlayers(owner.id);
    assert(first.added === 40 && again.added === 0, `sample players: first ${first.added}, again ${again.added}`);
    const byLevel = await prisma.openPlayNightRegistration.groupBy({ by: ["skillLevel"], where: { date }, _count: true });
    assert(byLevel.length === 4 && byLevel.every((g) => g._count === 10), `10 per level, got ${JSON.stringify(byLevel)}`);
    assert((await prisma.player.count()) === playersBefore, "sample players create no Player rows");
    assert((await prisma.sale.count()) === salesBefore, "sample players create no sales");
    console.log("PASS: Add sample players adds 10 per skill level, once, with no players or sales.");

    // 6. Clear practice.
    const cleared = await practiceService.clearPractice(owner.id);
    assert(cleared.players === 40 && cleared.games === 0, `clear reports what it removed, got ${JSON.stringify(cleared)}`);
    assert((await prisma.openPlayNightRegistration.count({ where: { date } })) === 0, "no practice names remain");
    assert((await prisma.gameAssignment.count({ where: { date } })) === 0, "no practice games remain");
    assert((await prisma.stagedGroup.count({ where: { date } })) === 0, "no practice staged sets remain");
    assert((await prisma.queueEntry.count({ where: { date } })) === 0, "the practice line is empty");
    assert((await prisma.sale.count()) === salesBefore, "clearing touched no sales");
    console.log("PASS: Clear practice removes every practice row and nothing else.");
  } finally {
    await practiceService.clearPractice(owner.id);
    await settingsService.setPracticeTakeoverRtv(takeoverBefore, owner.id);
    await prisma.auditLog.deleteMany({ where: { entityType: "Practice" } });
  }
  console.log("PASS: practice mode proven — never charged, never in sales.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
