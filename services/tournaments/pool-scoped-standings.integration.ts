/**
 * Owner request (2026-08-15), LIVE during the Sayans and Friends
 * tournament: "can we fix first the standing? can we sort it by pool?
 * ...and not the whole roster" — standingsService.getStandings now
 * ranks teams WITHIN their own pool (a pooled round robin never has
 * cross-pool matches, so a single global ranking mixed teams that never
 * played each other) and groups the result pool by pool instead of one
 * flat roster-wide list.
 *
 * Proves, against real rows:
 *   1. Every returned row carries the correct poolLabel for its team.
 *   2. Rows are grouped consecutively by pool (all of one pool's rows
 *      together, not interleaved with another pool's), in the same
 *      alphabetical pool order bracket-view.tsx already uses.
 *   3. Ranking within a pool is correct (the pool's own winner ranks
 *      ahead of its own loser) — proven for both pools, with the
 *      winning side deliberately different (team1 wins in one pool,
 *      team2 wins in the other) so no accidental symmetry could hide a
 *      real bug.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { matchService } from "./match.service";
import { standingsService } from "./standings.service";
import { tournamentService } from "./tournament.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(tournamentId: string | null): Promise<void> {
  if (!tournamentId) return;
  const category = await prisma.tournamentCategory.findFirst({ where: { tournamentId } });
  if (category) {
    await prisma.match.deleteMany({ where: { tournamentCategoryId: category.id } });
    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentCategoryId: category.id },
      select: { id: true, teamId: true, team: { select: { player1Id: true, player2Id: true } } },
    });
    const registrationIds = registrations.map((r) => r.id);
    const teamIds = registrations.map((r) => r.teamId);
    const playerIds = registrations.flatMap((r) =>
      r.team.player2Id ? [r.team.player1Id, r.team.player2Id] : [r.team.player1Id],
    );
    await prisma.tournamentRegistration.deleteMany({ where: { id: { in: registrationIds } } });
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
  const suffix = Date.now();

  let tournamentId: string | null = null;
  try {
    const tournament = await tournamentService.createTournament(
      {
        name: `Pool Standings Test Tournament ${suffix}`,
        startDate: new Date(2031, 11, 1),
        endDate: new Date(2031, 11, 2),
        collectsPaymentOnSite: false,
      },
      owner.id,
    );
    tournamentId = tournament.id;

    const category = await tournamentService.createCategory(
      tournament.id,
      { name: "Pool Standings Test", format: "ROUND_ROBIN", division: "OPEN" },
      owner.id,
    );

    const registrations = [];
    for (let i = 0; i < 4; i += 1) {
      registrations.push(
        await tournamentService.registerTeam(category.id, { player1Name: `Pool Standings ${i} ${suffix}` }, owner.id, null),
      );
    }

    const pools = await tournamentService.createPools(category.id, 2, owner.id);
    assert(pools.length === 2, `expected exactly 2 pools, got ${pools.length}`);
    assert(
      pools.every((pool) => pool.teamIds.length === 2),
      "expected 4 teams split evenly into 2 pools of 2",
    );

    await tournamentService.generateBracket(category.id, owner.id);
    const matches = await prisma.match.findMany({ where: { tournamentCategoryId: category.id } });
    assert(matches.length === 2, `expected exactly 1 match per pool (2 total), got ${matches.length}`);

    const registrationsWithPool = await prisma.tournamentRegistration.findMany({
      where: { tournamentCategoryId: category.id },
      select: { teamId: true, poolLabel: true },
    });
    const poolOfTeam = new Map(registrationsWithPool.map((r) => [r.teamId, r.poolLabel]));

    // Deliberately different winning side per pool (team1 wins the
    // first match, team2 wins the second) so no accidental left/right
    // symmetry could mask a real scoping bug.
    const [matchA, matchB] = matches;
    await matchService.recordScore(matchA!.id, { setNumber: 1, team1Score: 11, team2Score: 5 }, owner.id);
    await matchService.completeMatch(matchA!.id, owner.id);
    await matchService.recordScore(matchB!.id, { setNumber: 1, team1Score: 4, team2Score: 11 }, owner.id);
    await matchService.completeMatch(matchB!.id, owner.id);

    const winnerOfA = matchA!.team1Id;
    const loserOfA = matchA!.team2Id!;
    const winnerOfB = matchB!.team2Id!;
    const loserOfB = matchB!.team1Id;

    const standings = await standingsService.getStandings(category.id);
    assert(standings.format === "ROUND_ROBIN", "expected ROUND_ROBIN format");
    assert(standings.rows.length === 4, `expected 4 standing rows, got ${standings.rows.length}`);

    // ============== 1. Every row carries its team's correct poolLabel ==============
    for (const row of standings.rows) {
      assert(
        row.poolLabel === poolOfTeam.get(row.teamId),
        `expected row for team ${row.teamId} to carry its real poolLabel (${poolOfTeam.get(row.teamId)}), got ${row.poolLabel}`,
      );
    }
    console.log("PASS: every standings row carries the correct poolLabel for its team.");

    // ============== 2. Rows are grouped consecutively by pool, not interleaved ==============
    const seenPoolLabels = new Set<string | null>();
    let previousPoolLabel: string | null | undefined = undefined;
    for (const row of standings.rows) {
      if (row.poolLabel !== previousPoolLabel) {
        assert(
          !seenPoolLabels.has(row.poolLabel),
          `expected pool ${row.poolLabel} to appear as one consecutive block, not split across the list`,
        );
        seenPoolLabels.add(row.poolLabel);
        previousPoolLabel = row.poolLabel;
      }
    }
    const poolLabelsInOrder = [...seenPoolLabels];
    const sortedPoolLabels = [...poolLabelsInOrder].sort((a, b) => (a ?? "").localeCompare(b ?? ""));
    assert(
      JSON.stringify(poolLabelsInOrder) === JSON.stringify(sortedPoolLabels),
      `expected pool blocks in alphabetical order, got ${JSON.stringify(poolLabelsInOrder)}`,
    );
    console.log("PASS: standings rows are grouped consecutively by pool, in alphabetical pool order.");

    // ============== 3. Ranking within each pool is correct ==============
    const rowsById = new Map(standings.rows.map((row) => [row.teamId, row]));
    const indexById = new Map(standings.rows.map((row, index) => [row.teamId, index]));
    assert(rowsById.get(winnerOfA)!.wins === 1, "expected pool A's winner to have 1 win");
    assert(rowsById.get(loserOfA)!.losses === 1, "expected pool A's loser to have 1 loss");
    assert(
      indexById.get(winnerOfA)! < indexById.get(loserOfA)!,
      "expected pool A's winner to rank ahead of pool A's loser",
    );
    assert(rowsById.get(winnerOfB)!.wins === 1, "expected pool B's winner to have 1 win");
    assert(rowsById.get(loserOfB)!.losses === 1, "expected pool B's loser to have 1 loss");
    assert(
      indexById.get(winnerOfB)! < indexById.get(loserOfB)!,
      "expected pool B's winner to rank ahead of pool B's loser",
    );
    console.log("PASS: ranking within each pool is correct — each pool's own winner ranks ahead of its own loser.");

    await cleanUp(tournamentId);
    console.log("\nPASS: pool-scoped standings proven against real rows.");
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
