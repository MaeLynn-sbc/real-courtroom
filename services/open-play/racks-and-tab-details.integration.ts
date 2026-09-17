/**
 * Owner requests, 2026-09-17:
 *  - Six virtual paddle racks: when Rack 1 goes on court, Racks 2-6 each
 *    move up one, all the way down the line.
 *  - "When the customer settles the tab, the details appear": a finished
 *    game is billed as "OP · Court N · start–end", and the tab list
 *    returns an itemised breakdown with voided charges left out.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRotationService } from "./open-play-rotation.service";
import { playerTabService } from "./player-tab.service";

const TEST_DATE = new Date(2031, 6, 14); // a Monday, not used by other fixtures
const PREFIX = "Racktest";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function cleanUp(): Promise<void> {
  const regs = await prisma.openPlayNightRegistration.findMany({ where: { date: TEST_DATE }, select: { id: true, playerId: true } });
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
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...ids, ...players.map((p) => p.id)] } } });
  await prisma.player.deleteMany({ where: { id: { in: players.map((p) => p.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null, status: "ACTIVE" }, orderBy: { name: "asc" } });
  await cleanUp();

  try {
    // Seven checked-in players: two on Rack 1 (a game needs two), one on
    // each of the others.
    const regIds: string[] = [];
    for (let i = 1; i <= 7; i += 1) {
      const reg = await openPlayRegistrationService.registerWeeknightWalkIn(
        TEST_DATE,
        { playerName: `${PREFIX} P${i} ${Date.now()}`, phone: "1", skillLevel: "NOVICE" },
        owner.id,
      );
      await openPlayCheckinService.checkIn(reg.id, owner.id);
      regIds.push(reg.id);
    }
    const slots = ["NEXT_UP", "AFTER_THAT", "THEN", "RACK_4", "RACK_5", "RACK_6"] as const;
    const groups = [];
    for (const [i, slot] of slots.entries()) {
      const members = i === 0 ? [regIds[0], regIds[6]] : [regIds[i]];
      groups.push(await openPlayRotationService.stageManualGroup(TEST_DATE, slot, members, owner.id));
    }

    // A one-player rack can't go on court, and says why.
    let refused = "";
    try {
      await openPlayRotationService.assignPendingGroupToCourt(TEST_DATE, court.id, groups[1].id, owner.id);
    } catch (error) {
      refused = (error as Error).message;
    }
    assert(/at least 2 players/.test(refused), `a one-player rack explains it needs two, got "${refused}"`);

    // 1. Rack 1 goes on court: every rack behind moves up one.
    await openPlayRotationService.assignPendingGroupToCourt(TEST_DATE, court.id, groups[0].id, owner.id);
    const after = await prisma.stagedGroup.findMany({ where: { date: TEST_DATE } });
    const slotOf = (id: string) => after.find((g) => g.id === id)?.slot;
    assert(slotOf(groups[1].id) === "NEXT_UP", "Rack 2 became Rack 1");
    assert(slotOf(groups[2].id) === "AFTER_THAT", "Rack 3 became Rack 2");
    assert(slotOf(groups[3].id) === "THEN", "Rack 4 became Rack 3");
    assert(slotOf(groups[4].id) === "RACK_4", "Rack 5 became Rack 4");
    assert(slotOf(groups[5].id) === "RACK_5", "Rack 6 became Rack 5");
    assert(!after.some((g) => g.slot === "RACK_6"), "Rack 6 is empty and free to fill");
    console.log("PASS: sending Rack 1 to court moves all five racks behind it up one.");

    // 2. Play the game: the tab charge carries court and time.
    const game = await prisma.gameAssignment.findFirstOrThrow({ where: { date: TEST_DATE, courtId: court.id } });
    await openPlayRotationService.confirmAssignment(game.id, owner.id);
    await openPlayRotationService.completeAssignment(game.id, owner.id);
    const charge = await prisma.tabLineItem.findFirstOrThrow({ where: { gameAssignmentId: game.id } });
    assert(charge.description.startsWith(`OP · ${court.name} · `), `the charge names the court, got "${charge.description}"`);
    assert(/\d{1,2}:\d{2}\s?[AP]M–\d{1,2}:\d{2}\s?[AP]M$/.test(charge.description), `the charge shows start–end, got "${charge.description}"`);
    console.log(`PASS: a finished game is billed as "${charge.description}".`);

    // 3. The tab list itemises it; an old plain "Game" charge is rebuilt
    //    from its game; a voided charge is left out.
    await prisma.tabLineItem.update({ where: { id: charge.id }, data: { description: "Game" } });
    const tab = await prisma.playerTab.findUniqueOrThrow({ where: { registrationId: regIds[0] } });
    const extra = await prisma.tabLineItem.create({
      data: { tabId: tab.id, type: "ADJUSTMENT", description: "Mistake", qtyOrGames: 1, unitPriceCents: 500, amountCents: 500 },
    });
    await prisma.tabLineItem.create({
      data: { tabId: tab.id, type: "ADJUSTMENT", description: "Void", qtyOrGames: 1, unitPriceCents: -500, amountCents: -500, voidsLineItemId: extra.id },
    });
    const listed = (await playerTabService.listTabsForDate(TEST_DATE)).find((t) => t.id === tab.id);
    assert(listed, "the tab is listed");
    assert(listed.items.length === 1, `only the live game charge is itemised, got ${listed.items.length}`);
    assert(listed.items[0].description.startsWith(`OP · ${court.name} · `), "an old plain 'Game' charge still shows court and time");
    assert(listed.totalCents === charge.amountCents, "the total is unchanged by the void pair");
    console.log("PASS: the tab breakdown shows game details, including older charges, and hides voided ones.");
  } finally {
    await cleanUp();
  }
  console.log("PASS: racks and tab details proven.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
