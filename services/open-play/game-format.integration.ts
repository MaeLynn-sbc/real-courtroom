/**
 * Game format switch (owner, 2026-09-18): 15 min · ₱30 per game when on,
 * the regular settings when off. Each game keeps the format it was put on
 * court with — for its TV timer and its tab charge — so flipping the
 * switch never changes a game already running.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { SHORT_GAME_MINUTES, SHORT_GAME_RATE_CENTS } from "../../lib/game-format";
import { prisma } from "../../lib/prisma";
import { displayService } from "../display/display.service";
import { settingsService } from "../settings/settings.service";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRotationService } from "./open-play-rotation.service";

const TEST_DATE = new Date(2031, 6, 21); // a Monday, not used by other fixtures
const PREFIX = "Formattest";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function cleanUp(): Promise<void> {
  const regs = await prisma.openPlayNightRegistration.findMany({ where: { date: TEST_DATE }, select: { id: true } });
  const ids = regs.map((r) => r.id);
  await prisma.tabLineItem.deleteMany({ where: { tab: { registrationId: { in: ids } } } });
  await prisma.playerTab.deleteMany({ where: { registrationId: { in: ids } } });
  await prisma.gameAssignment.deleteMany({ where: { date: TEST_DATE } });
  await prisma.recentPairing.deleteMany({ where: { date: TEST_DATE } });
  await prisma.queueEntry.deleteMany({ where: { date: TEST_DATE } });
  await prisma.stagedGroup.deleteMany({ where: { date: TEST_DATE } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { id: { in: ids } } });
  const users = await prisma.user.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  const players = await prisma.player.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { id: true } });
  await prisma.player.deleteMany({ where: { id: { in: players.map((p) => p.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const courts = await prisma.court.findMany({ where: { deletedAt: null, status: "ACTIVE" }, orderBy: { name: "asc" }, take: 2 });
  assert(courts.length === 2, "needs two courts");
  const shortBefore = await settingsService.getOpenPlayShortGame();
  const settings = await settingsService.getOpenPlaySettings();
  await cleanUp();

  try {
    const regIds: string[] = [];
    for (let i = 1; i <= 4; i += 1) {
      const reg = await openPlayRegistrationService.registerWeeknightWalkIn(
        TEST_DATE,
        { playerName: `${PREFIX} P${i} ${Date.now()}`, phone: "1", skillLevel: "NOVICE" },
        owner.id,
      );
      await openPlayCheckinService.checkIn(reg.id, owner.id);
      regIds.push(reg.id);
    }

    // Short format: the game snapshots 15 min / ₱30.
    await settingsService.setOpenPlayShortGame(true, owner.id);
    const shortGame = await openPlayRotationService.createManualAssignment(TEST_DATE, courts[0].id, regIds.slice(0, 2), owner.id);
    assert(
      shortGame.gameMinutes === SHORT_GAME_MINUTES && shortGame.gameRateCents === SHORT_GAME_RATE_CENTS,
      `short game snapshot, got ${shortGame.gameMinutes} min / ${shortGame.gameRateCents}`,
    );

    // Flip back to regular before the second game.
    await settingsService.setOpenPlayShortGame(false, owner.id);
    const regularGame = await openPlayRotationService.createManualAssignment(TEST_DATE, courts[1].id, regIds.slice(2, 4), owner.id);
    assert(
      regularGame.gameMinutes === settings.targetGameMinutes && regularGame.gameRateCents === settings.weeknightGameRateCents,
      "regular game snapshot follows the open play settings",
    );
    console.log("PASS: each game snapshots the format that applied when it was put on court.");

    // Start both; the timer runs each game's own length, even though the
    // switch is now back to regular.
    await openPlayRotationService.confirmAssignment(shortGame.id, owner.id);
    await openPlayRotationService.confirmAssignment(regularGame.id, owner.id);
    const board = await openPlayRotationService.getRotationBoardData(TEST_DATE);
    const started = board.courts.find((c) => c.court.id === courts[0].id)?.active;
    assert(started?.gameMinutes === SHORT_GAME_MINUTES, "the running short game keeps its 15 minutes after the switch flips");
    const frameFormat = (await displayService.getDisplayData()).targetGameMinutes;
    assert(frameFormat === settings.targetGameMinutes, "the TV forecasts new games at the current (regular) length");
    console.log("PASS: flipping the switch never changes a running game's length.");

    // Finish both: each tab is charged its own game's price, with the
    // length shown on the charge.
    await openPlayRotationService.completeAssignment(shortGame.id, owner.id);
    await openPlayRotationService.completeAssignment(regularGame.id, owner.id);
    const shortCharge = await prisma.tabLineItem.findFirstOrThrow({ where: { gameAssignmentId: shortGame.id } });
    const regularCharge = await prisma.tabLineItem.findFirstOrThrow({ where: { gameAssignmentId: regularGame.id } });
    assert(shortCharge.amountCents === SHORT_GAME_RATE_CENTS, `short game charged ₱30, got ${shortCharge.amountCents}`);
    assert(shortCharge.description.endsWith(`· ${SHORT_GAME_MINUTES} min`), `short charge shows 15 min, got "${shortCharge.description}"`);
    assert(regularCharge.amountCents === settings.weeknightGameRateCents, "regular game charged the regular rate");
    assert(regularCharge.description.endsWith(`· ${settings.targetGameMinutes} min`), `regular charge shows its length, got "${regularCharge.description}"`);
    console.log(`PASS: tabs are charged per game — "${shortCharge.description}" at ₱${shortCharge.amountCents / 100}.`);
  } finally {
    await settingsService.setOpenPlayShortGame(shortBefore, owner.id);
    await cleanUp();
  }
  console.log("PASS: game format switch proven.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
