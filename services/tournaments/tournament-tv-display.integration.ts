/**
 * Owner request (2026-08-09): a TV display for tournaments (/tourtv),
 * auto-calling doubles matches to a court the moment staff assign one —
 * same concept as Open Play's TV, for Match instead of GameAssignment.
 *
 * Proves, against real rows:
 *   1. scheduleMatch stamps a real, non-null announcementRequestedAt the
 *      instant a court is assigned — no separate "Announce" step exists
 *      for tournaments; assigning the court IS the trigger.
 *   2. Re-scheduling (even to the same court) bumps it again, to a
 *      fresh, later timestamp — freely re-triggerable, same shape as
 *      Open Play's manual re-announce.
 *   3. tournamentDisplayService.getDisplayData() surfaces a court-
 *      assigned, non-bye, SCHEDULED/IN_PROGRESS match with correctly
 *      shortened ("First L.") team names on both sides.
 *   4. A match with NO court assigned is excluded.
 *   5. A bye (team2Id null) is excluded even if it somehow has a court.
 *   6. A COMPLETED match is excluded even though it still has a court.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { matchService } from "./match.service";
import { tournamentService } from "./tournament.service";
import { tournamentDisplayService } from "../display/tournament-display.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanUp(tournamentId: string | null): Promise<void> {
  if (!tournamentId) return;
  const categories = await prisma.tournamentCategory.findMany({
    where: { tournamentId },
    select: { id: true },
  });
  for (const category of categories) {
    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentCategoryId: category.id },
      select: { id: true, teamId: true, team: { select: { player1Id: true, player2Id: true } } },
    });
    const teamIds = registrations.map((r) => r.teamId);
    const playerIds = registrations.flatMap((r) =>
      r.team.player2Id ? [r.team.player1Id, r.team.player2Id] : [r.team.player1Id],
    );
    await prisma.match.deleteMany({ where: { tournamentCategoryId: category.id } });
    await prisma.tournamentRegistration.deleteMany({
      where: { id: { in: registrations.map((r) => r.id) } },
    });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    const players = await prisma.player.findMany({ where: { id: { in: playerIds } }, select: { userId: true } });
    await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: players.map((p) => p.userId) } } });
  }
  await prisma.tournamentCategory.deleteMany({ where: { tournamentId } });
  await prisma.tournament.deleteMany({ where: { id: tournamentId } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, take: 2, orderBy: { name: "asc" } });
  assert(courts.length >= 2, "expected at least two active courts as fixtures");
  const [courtA, courtB] = courts;
  const suffix = Date.now();

  let tournamentId: string | null = null;
  try {
    const tournament = await tournamentService.createTournament(
      {
        name: `TourTV Test Tournament ${suffix}`,
        startDate: new Date(2031, 9, 10),
        endDate: new Date(2031, 9, 11),
        collectsPaymentOnSite: false,
      },
      owner.id,
    );
    tournamentId = tournament.id;

    const category = await tournamentService.createCategory(
      tournament.id,
      { name: "TourTV Doubles", format: "ROUND_ROBIN", division: "OPEN" },
      owner.id,
    );

    const reg1 = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Mae Tanaka${suffix}`, player2Name: `Jane Cruz${suffix}` },
      owner.id,
      null,
    );
    const reg2 = await tournamentService.registerTeam(
      category.id,
      { player1Name: `John Alba${suffix}`, player2Name: `Ben Bautista${suffix}` },
      owner.id,
      null,
    );

    const match = await prisma.match.create({
      data: {
        tournamentCategoryId: category.id,
        team1Id: reg1.teamId,
        team2Id: reg2.teamId,
        status: "SCHEDULED",
      },
    });

    // ============== 1. Auto-fires on court assignment ==============
    const scheduled = await matchService.scheduleMatch(match.id, { courtId: courtA.id }, owner.id);
    assert(
      scheduled.announcementRequestedAt !== null,
      "expected announcementRequestedAt to be stamped the instant a court is assigned",
    );
    const firstAnnouncedAt = scheduled.announcementRequestedAt!.getTime();
    console.log("PASS: scheduleMatch auto-fires the announcement the instant a court is assigned.");

    // ============== 2. Re-scheduling bumps it again ==============
    await sleep(10);
    const rescheduled = await matchService.scheduleMatch(match.id, { courtId: courtB.id }, owner.id);
    assert(
      rescheduled.announcementRequestedAt !== null &&
        rescheduled.announcementRequestedAt.getTime() > firstAnnouncedAt,
      "expected re-scheduling to bump announcementRequestedAt forward, freely re-triggerable",
    );
    console.log("PASS: re-scheduling (even to a different court) re-announces with a fresh timestamp.");

    // ============== 3. Surfaces correctly in the display feed ==============
    const displayed = await tournamentDisplayService.getDisplayData();
    const displayedMatch = displayed.matches.find((m) => m.id === match.id);
    assert(displayedMatch, "expected the court-assigned match to appear in tournamentDisplayService.getDisplayData()");
    assert(
      displayedMatch!.courtName === courtB.name,
      `expected courtName to be the most recently assigned court (${courtB.name}), got ${displayedMatch!.courtName}`,
    );
    assert(
      displayedMatch!.team1.names.join(",") === "Mae T.,Jane C.",
      `expected team1 names shortened to "First L.", got ${displayedMatch!.team1.names.join(",")}`,
    );
    assert(
      displayedMatch!.team2.names.join(",") === "John A.,Ben B.",
      `expected team2 names shortened to "First L.", got ${displayedMatch!.team2.names.join(",")}`,
    );
    console.log("PASS: the match surfaces in the display feed with correctly shortened team names on both sides.");

    // ============== 3b. Team numbers ("1a"/"2a") surface too ==============
    // Set directly, not via setTeamPool — that service method correctly
    // refuses once a match exists for the category (this test creates
    // Match rows by hand, not via generateBracket), a real guard not
    // being tested here.
    await prisma.tournamentRegistration.update({
      where: { tournamentCategoryId_teamId: { tournamentCategoryId: category.id, teamId: reg1.teamId } },
      data: { poolLabel: "A", poolPosition: 1 },
    });
    await prisma.tournamentRegistration.update({
      where: { tournamentCategoryId_teamId: { tournamentCategoryId: category.id, teamId: reg2.teamId } },
      data: { poolLabel: "A", poolPosition: 2 },
    });
    const displayedWithPools = await tournamentDisplayService.getDisplayData();
    const matchWithPools = displayedWithPools.matches.find((m) => m.id === match.id);
    assert(matchWithPools, "expected the match to still appear after pool assignment");
    assert(
      matchWithPools!.team1.number === "1a",
      `expected team1's number to be "1a" (first team assigned to pool A), got ${matchWithPools!.team1.number}`,
    );
    assert(
      matchWithPools!.team2.number === "2a",
      `expected team2's number to be "2a" (second team assigned to pool A), got ${matchWithPools!.team2.number}`,
    );
    console.log("PASS: getDisplayData surfaces each team's real pool number (\"1a\"/\"2a\"), scoped by category.");

    // ============== 4. No court assigned — excluded ==============
    const unassignedMatch = await prisma.match.create({
      data: { tournamentCategoryId: category.id, team1Id: reg1.teamId, team2Id: reg2.teamId, status: "SCHEDULED" },
    });
    const afterUnassigned = await tournamentDisplayService.getDisplayData();
    assert(
      !afterUnassigned.matches.some((m) => m.id === unassignedMatch.id),
      "expected a match with no court assigned to be excluded from the display feed",
    );
    console.log("PASS: a match with no court assigned is excluded.");

    // ============== 5. A bye (team2Id null) is excluded even with a court ==============
    const byeMatch = await prisma.match.create({
      data: { tournamentCategoryId: category.id, team1Id: reg1.teamId, team2Id: null, courtId: courtA.id, status: "SCHEDULED" },
    });
    const afterBye = await tournamentDisplayService.getDisplayData();
    assert(
      !afterBye.matches.some((m) => m.id === byeMatch.id),
      "expected a bye (no opposing team) to be excluded even with a court assigned",
    );
    console.log("PASS: a bye with no opposing team is excluded even with a court assigned.");

    // ============== 6. A COMPLETED match is excluded even with a court ==============
    const completedMatch = await prisma.match.create({
      data: {
        tournamentCategoryId: category.id,
        team1Id: reg1.teamId,
        team2Id: reg2.teamId,
        courtId: courtA.id,
        status: "COMPLETED",
        announcementRequestedAt: new Date(),
      },
    });
    const afterCompleted = await tournamentDisplayService.getDisplayData();
    assert(
      !afterCompleted.matches.some((m) => m.id === completedMatch.id),
      "expected a COMPLETED match to be excluded even though it still has a court assigned",
    );
    console.log("PASS: a COMPLETED match is excluded even though it still has a court assigned.");

    await cleanUp(tournamentId);
    console.log("\nPASS: tournament TV display (/tourtv) proven against real rows.");
  } catch (error) {
    await cleanUp(tournamentId);
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
