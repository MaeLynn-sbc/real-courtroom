/**
 * Owner requests, 2026-09-17:
 *  - The line (Next up, After that, Then, Racks 1-6) moves up only with
 *    complete groups: an incomplete rack holds its place and nothing
 *    passes it.
 *  - "When the customer settles the tab, the details appear": a finished
 *    game is billed as "OP · Court N · start–end", and the tab list
 *    returns an itemised breakdown with voided charges left out.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { STAGED_SLOTS } from "../../lib/staged-slots";
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
  const regs = await prisma.openPlayNightRegistration.findMany({
    where: { date: TEST_DATE },
    select: { id: true, playerId: true },
  });
  const ids = regs.map((r) => r.id);
  await prisma.tabLineItem.deleteMany({ where: { tab: { registrationId: { in: ids } } } });
  await prisma.playerTab.deleteMany({ where: { registrationId: { in: ids } } });
  await prisma.gameAssignment.deleteMany({ where: { date: TEST_DATE } });
  await prisma.recentPairing.deleteMany({ where: { date: TEST_DATE } });
  await prisma.queueEntry.deleteMany({ where: { date: TEST_DATE } });
  await prisma.stagedGroup.deleteMany({ where: { date: TEST_DATE } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { id: { in: ids } } });
  const users = await prisma.user.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  });
  const players = await prisma.player.findMany({
    where: { userId: { in: users.map((u) => u.id) } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: [...ids, ...players.map((p) => p.id)] } },
  });
  await prisma.player.deleteMany({ where: { id: { in: players.map((p) => p.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({
    where: { deletedAt: null, status: "ACTIVE" },
    orderBy: { name: "asc" },
  });
  await cleanUp();

  try {
    // Thirty-four checked-in players.
    const regIds: string[] = [];
    for (let i = 1; i <= 34; i += 1) {
      const reg = await openPlayRegistrationService.registerWeeknightWalkIn(
        TEST_DATE,
        { playerName: `${PREFIX} P${i} ${Date.now()}`, phone: "1", skillLevel: "NOVICE" },
        owner.id,
      );
      await openPlayCheckinService.checkIn(reg.id, owner.id);
      regIds.push(reg.id);
    }
    let cursor = 0;
    const take = (n: number) => {
      const ids = regIds.slice(cursor, cursor + n);
      cursor += n;
      return ids;
    };
    const stage = (
      slot: Parameters<typeof openPlayRotationService.stageManualGroup>[1],
      n: number,
    ) => openPlayRotationService.stageManualGroup(TEST_DATE, slot, take(n), owner.id);
    const slotOf = async (id: string) =>
      (await prisma.stagedGroup.findUnique({ where: { id } }))?.slot ?? null;

    // Next up 2 (short but playable), After that 4, Then 4, Rack 1 with
    // 3 (incomplete), Rack 2 with 4, and a full group put on Rack 4.
    const nextUp = await stage("NEXT_UP", 2);
    const afterThat = await stage("AFTER_THAT", 4);
    const then = await stage("THEN", 4);
    const rack1 = await stage("RACK_4", 3);
    const rack2 = await stage("RACK_5", 4);
    const rack4 = await stage("RACK_7", 4);
    assert(
      (await slotOf(rack4.id)) === "RACK_6",
      "a full group put on Rack 4 closes the gap to Rack 3",
    );
    assert(
      (await slotOf(rack2.id)) === "RACK_5",
      "a full group behind an incomplete rack stays behind it",
    );
    console.log("PASS: full groups close gaps but never pass an incomplete rack.");

    // 0. A one-player group can't go on court, and says why.
    const solo = await openPlayRotationService.stageManualGroup(
      TEST_DATE,
      "RACK_8",
      take(1),
      owner.id,
    );
    let refused = "";
    try {
      await openPlayRotationService.assignPendingGroupToCourt(
        TEST_DATE,
        court.id,
        solo.id,
        owner.id,
      );
    } catch (error) {
      refused = (error as Error).message;
    }
    assert(
      /at least 2 players/.test(refused),
      `a one-player group explains it needs two, got "${refused}"`,
    );

    // 1. Next up goes on court. After that and Then move up; Rack 1 is
    //    incomplete, so it stays — and so does everything behind it.
    await openPlayRotationService.assignPendingGroupToCourt(
      TEST_DATE,
      court.id,
      nextUp.id,
      owner.id,
    );
    assert((await slotOf(afterThat.id)) === "NEXT_UP", "After that became Next up");
    assert((await slotOf(then.id)) === "AFTER_THAT", "Then became After that");
    assert(
      (await slotOf(rack1.id)) === "RACK_4",
      "incomplete Rack 1 did NOT move forward into Then",
    );
    assert((await slotOf(rack2.id)) === "RACK_5", "Rack 2 did not pass the incomplete Rack 1");
    assert((await slotOf(rack4.id)) === "RACK_6", "Rack 3 stayed in order");
    console.log(
      "PASS: when Next up goes on court, complete groups move up and an incomplete rack holds its place.",
    );

    // 2. Completing Rack 1 moves it forward, and the full racks follow.
    await openPlayRotationService.addPlayerToStagedGroup(rack1.id, take(1)[0], owner.id);
    assert((await slotOf(rack1.id)) === "THEN", "a completed Rack 1 moved up into Then");
    assert((await slotOf(rack2.id)) === "RACK_4", "Rack 2 followed into Rack 1");
    assert((await slotOf(rack4.id)) === "RACK_5", "Rack 3 followed into Rack 2");
    console.log(
      "PASS: completing an incomplete rack lets it, and the full racks behind it, move up.",
    );

    // 2. Play the game: the tab charge carries court and time.
    const game = await prisma.gameAssignment.findFirstOrThrow({
      where: { date: TEST_DATE, courtId: court.id },
    });
    // A group starts forming while that game is still on court.
    const waitingGroup = await stage("RACK_6", 3);
    await openPlayRotationService.confirmAssignment(game.id, owner.id);
    await openPlayRotationService.completeAssignment(game.id, owner.id);
    const charge = await prisma.tabLineItem.findFirstOrThrow({
      where: { gameAssignmentId: game.id },
    });

    // Returning-player rule: a waiting group completed by someone who just
    // played goes to the back; the same group completed by a fresh player
    // stays where it is.
    const returning = nextUp.members[0].registrationId;
    const backOfLine = (await prisma.stagedGroup.findMany({ where: { date: TEST_DATE } }))
      .map((g) => g.slot)
      .sort((a, b) => STAGED_SLOTS.indexOf(b) - STAGED_SLOTS.indexOf(a))[0];
    await openPlayRotationService.addPlayerToStagedGroup(waitingGroup.id, returning, owner.id);
    const movedTo = await slotOf(waitingGroup.id);
    assert(
      movedTo !== null && STAGED_SLOTS.indexOf(movedTo) > STAGED_SLOTS.indexOf(backOfLine),
      `a group completed by a just-played player moves behind everyone (was behind ${backOfLine}, now ${movedTo})`,
    );
    const freshGroup = await stage("RACK_6", 3);
    await openPlayRotationService.addPlayerToStagedGroup(freshGroup.id, take(1)[0], owner.id);
    assert(
      (await slotOf(freshGroup.id)) === "RACK_6",
      "a group completed by a fresh player keeps its place",
    );
    console.log(
      `PASS: a group completed by a player who just played goes to the back (${movedTo}); a fresh player's does not.`,
    );

    // Racks 7-12: a full group put on Rack 12 moves forward like any other.
    const farGroup = await stage("RACK_15", 4);
    const farSlot = await slotOf(farGroup.id);
    assert(farSlot !== "RACK_15", `a full group on Rack 12 moves forward, stayed at ${farSlot}`);
    console.log(`PASS: Racks 7-12 exist and a full group there moves forward (to ${farSlot}).`);

    // Edit: a corrected skill reaches the queue entry and the player profile.
    const edited = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: regIds[1] } });
    await openPlayRegistrationService.updateRegistrationDetails(
      regIds[1],
      { skillLevel: "ADVANCED", phone: "09175550999" },
      owner.id,
    );
    const editedEntry = await prisma.queueEntry.findUniqueOrThrow({ where: { registrationId: regIds[1] } });
    assert(editedEntry.skillLevel === "ADVANCED", "the edited skill reaches the rotation queue");
    assert(edited.playerId, "walk-ins are linked to a player");
    const profile = await prisma.player.findUniqueOrThrow({ where: { id: edited.playerId } });
    assert(
      profile.openPlaySkillLevel === "ADVANCED" && profile.phone === "09175550999",
      "the edited skill and phone reach the player profile",
    );
    console.log("PASS: editing a waiting player's skill and phone updates the queue and their profile.");
    assert(
      charge.description.startsWith(`OP · ${court.name} · `),
      `the charge names the court, got "${charge.description}"`,
    );
    assert(
      /\d{1,2}:\d{2}\s?[AP]M–\d{1,2}:\d{2}\s?[AP]M$/.test(charge.description),
      `the charge shows start–end, got "${charge.description}"`,
    );
    console.log(`PASS: a finished game is billed as "${charge.description}".`);

    // 3. The tab list itemises it; an old plain "Game" charge is rebuilt
    //    from its game; a voided charge is left out.
    await prisma.tabLineItem.update({ where: { id: charge.id }, data: { description: "Game" } });
    const tab = await prisma.playerTab.findUniqueOrThrow({
      where: { registrationId: nextUp.members[0].registrationId },
    });
    const extra = await prisma.tabLineItem.create({
      data: {
        tabId: tab.id,
        type: "ADJUSTMENT",
        description: "Mistake",
        qtyOrGames: 1,
        unitPriceCents: 500,
        amountCents: 500,
      },
    });
    await prisma.tabLineItem.create({
      data: {
        tabId: tab.id,
        type: "ADJUSTMENT",
        description: "Void",
        qtyOrGames: 1,
        unitPriceCents: -500,
        amountCents: -500,
        voidsLineItemId: extra.id,
      },
    });
    const listed = (await playerTabService.listTabsForDate(TEST_DATE)).find((t) => t.id === tab.id);
    assert(listed, "the tab is listed");
    assert(
      listed.items.length === 1,
      `only the live game charge is itemised, got ${listed.items.length}`,
    );
    assert(
      listed.items[0].description.startsWith(`OP · ${court.name} · `),
      "an old plain 'Game' charge still shows court and time",
    );
    assert(listed.totalCents === charge.amountCents, "the total is unchanged by the void pair");
    // The returning player now sits in the last rack (see the rule above).
    assert(listed.placement === "Rack 6", `the tab says where the player is, got "${listed.placement}"`);
    console.log(
      "PASS: the tab breakdown shows game details, including older charges, and hides voided ones.",
    );
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
