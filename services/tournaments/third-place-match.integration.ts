/**
 * Owner request (2026-08-17), against a reference bracket showing a
 * "BRONZE" slot beside the final: a third-place playoff between the two
 * SEMIFINAL LOSERS. Nothing in this service had ever looked at a loser
 * before — tryAdvanceBracket only ever advances winners.
 *
 * Proves, against real rows:
 *   1. OFF by default — completing both semis creates the final and
 *      nothing else, exactly as before this feature existed.
 *   2. ON — completing both semis creates the final AND the bronze match,
 *      containing precisely the two losers.
 *   3. The bronze match sits at the final's own round, bracketPosition 1,
 *      and does NOT disturb the final at position 0.
 *   4. Turning it on AFTER the semis are already decided creates the match
 *      retroactively (the common real-world case).
 *   5. Turning it off again removes an unplayed bronze match.
 *   6. Turning it off is REFUSED once that match has been played.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { BRONZE_BRACKET_POSITION } from "./bracket-generator";
import { matchService } from "./match.service";
import { tournamentService } from "./tournament.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function makeTeam(name: string): Promise<string> {
  const memberRole = await prisma.role.findUniqueOrThrow({ where: { name: "MEMBER" } });
  const user = await prisma.user.create({ data: { name, roleId: memberRole.id } });
  const player = await prisma.player.create({ data: { userId: user.id } });
  const team = await prisma.team.create({ data: { player1Id: player.id, name } });
  return team.id;
}

// A 4-team knockout: two semifinals (round 1) feeding one final (round 2).
async function buildSemifinals(categoryId: string, teamIds: string[]) {
  return Promise.all([
    prisma.match.create({
      data: {
        tournamentCategoryId: categoryId,
        round: 1,
        bracketPosition: 0,
        team1Id: teamIds[0],
        team2Id: teamIds[1],
        status: "SCHEDULED",
      },
    }),
    prisma.match.create({
      data: {
        tournamentCategoryId: categoryId,
        round: 1,
        bracketPosition: 1,
        team1Id: teamIds[2],
        team2Id: teamIds[3],
        status: "SCHEDULED",
      },
    }),
  ]);
}

async function decide(matchId: string, winnerTeamId: string, ownerId: string) {
  await matchService.markWalkover(matchId, winnerTeamId, ownerId);
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const createdCategoryIds: string[] = [];
  const createdTeamIds: string[] = [];
  let tournamentId: string | null = null;

  try {
    const tournament = await tournamentService.createTournament(
      {
        name: `Bronze Test ${Date.now()}`,
        startDate: new Date(2026, 0, 1),
        endDate: new Date(2026, 0, 1),
        collectsPaymentOnSite: false,
      },
      owner.id,
    );
    tournamentId = tournament.id;

    async function freshCategory(hasThirdPlaceMatch: boolean) {
      const category = await tournamentService.createCategory(
        tournament.id,
        { name: `Cat ${createdCategoryIds.length}`, format: "SINGLE_ELIMINATION", division: "OPEN" },
        owner.id,
      );
      createdCategoryIds.push(category.id);
      if (hasThirdPlaceMatch) {
        await prisma.tournamentCategory.update({
          where: { id: category.id },
          data: { hasThirdPlaceMatch: true },
        });
      }
      const teamIds = await Promise.all(
        [0, 1, 2, 3].map((i) => makeTeam(`T${createdCategoryIds.length}-${i}`)),
      );
      createdTeamIds.push(...teamIds);
      const semis = await buildSemifinals(category.id, teamIds);
      return { category, teamIds, semis };
    }

    // ============== 1. OFF by default — final only ==============
    {
      const { category, teamIds, semis } = await freshCategory(false);
      await decide(semis[0].id, teamIds[0], owner.id);
      await decide(semis[1].id, teamIds[2], owner.id);

      const finalRound = await prisma.match.findMany({
        where: { tournamentCategoryId: category.id, round: 2 },
      });
      assert(
        finalRound.length === 1 && finalRound[0].bracketPosition === 0,
        `expected only the final in round 2 when the setting is off, got ${finalRound.length} match(es)`,
      );
      console.log("PASS: off by default — completing both semis creates the final and nothing else.");
    }

    // ============== 2 & 3. ON — bronze created from the two LOSERS ==============
    {
      const { category, teamIds, semis } = await freshCategory(true);
      await decide(semis[0].id, teamIds[0], owner.id); // loser: teamIds[1]
      await decide(semis[1].id, teamIds[2], owner.id); // loser: teamIds[3]

      const finalRound = await prisma.match.findMany({
        where: { tournamentCategoryId: category.id, round: 2 },
        orderBy: { bracketPosition: "asc" },
      });
      assert(finalRound.length === 2, `expected a final AND a bronze match, got ${finalRound.length}`);

      const [finalMatch, bronze] = finalRound;
      assert(finalMatch.bracketPosition === 0, "expected the final to stay at bracketPosition 0");
      assert(
        bronze.bracketPosition === BRONZE_BRACKET_POSITION,
        `expected the bronze match at position ${BRONZE_BRACKET_POSITION}, got ${bronze.bracketPosition}`,
      );
      assert(
        finalMatch.team1Id === teamIds[0] && finalMatch.team2Id === teamIds[2],
        "expected the final to contain the two WINNERS",
      );
      const bronzeTeams = [bronze.team1Id, bronze.team2Id];
      assert(
        bronzeTeams.includes(teamIds[1]) && bronzeTeams.includes(teamIds[3]),
        `expected the bronze match to contain the two LOSERS, got ${JSON.stringify(bronzeTeams)}`,
      );
      assert(
        !bronzeTeams.includes(teamIds[0]) && !bronzeTeams.includes(teamIds[2]),
        "expected no winner to appear in the bronze match",
      );
      console.log("PASS: bronze match created from the two semifinal losers, beside the final at position 1.");
    }

    // ============== 4. Retroactive — turned on after the semis are decided ==============
    {
      const { category, teamIds, semis } = await freshCategory(false);
      await decide(semis[0].id, teamIds[0], owner.id);
      await decide(semis[1].id, teamIds[2], owner.id);

      const before = await prisma.match.count({
        where: { tournamentCategoryId: category.id, round: 2 },
      });
      assert(before === 1, "fixture check: expected only the final before enabling");

      await matchService.setThirdPlaceMatch(category.id, true, owner.id);

      const bronze = await prisma.match.findFirst({
        where: {
          tournamentCategoryId: category.id,
          round: 2,
          bracketPosition: BRONZE_BRACKET_POSITION,
        },
      });
      assert(bronze, "expected turning the setting on afterwards to create the bronze match");
      const bronzeTeams = [bronze!.team1Id, bronze!.team2Id];
      assert(
        bronzeTeams.includes(teamIds[1]) && bronzeTeams.includes(teamIds[3]),
        "expected the retroactively-created bronze match to contain the two losers",
      );
      console.log("PASS: enabling it after the semis are decided creates the bronze match retroactively.");

      // ============== 5. Turning it off removes an unplayed bronze match ==============
      await matchService.setThirdPlaceMatch(category.id, false, owner.id);
      const afterOff = await prisma.match.findFirst({
        where: {
          tournamentCategoryId: category.id,
          round: 2,
          bracketPosition: BRONZE_BRACKET_POSITION,
        },
      });
      assert(afterOff === null, "expected turning it off to remove the unplayed bronze match");
      console.log("PASS: turning it off removes a bronze match that was never played.");

      // ============== 6. Refused once the bronze match has been played ==============
      await matchService.setThirdPlaceMatch(category.id, true, owner.id);
      const replayed = await prisma.match.findFirstOrThrow({
        where: {
          tournamentCategoryId: category.id,
          round: 2,
          bracketPosition: BRONZE_BRACKET_POSITION,
        },
      });
      await matchService.markWalkover(replayed.id, replayed.team1Id, owner.id);

      let refused = false;
      try {
        await matchService.setThirdPlaceMatch(category.id, false, owner.id);
      } catch (error) {
        refused = true;
        assert(
          String(error).includes("already been played"),
          `expected an already-played error, got ${error}`,
        );
      }
      assert(refused, "expected turning it off to be refused once the bronze match has been played");
      console.log("PASS: refuses to remove a bronze match that has already been played.");
    }

    console.log("\nPASS: third-place (bronze) match proven against real rows.");
  } finally {
    for (const categoryId of createdCategoryIds) {
      await prisma.match.deleteMany({ where: { tournamentCategoryId: categoryId } });
      await prisma.tournamentRegistration.deleteMany({ where: { tournamentCategoryId: categoryId } });
      await prisma.tournamentCategory.delete({ where: { id: categoryId } }).catch(() => undefined);
    }
    for (const teamId of createdTeamIds) {
      await prisma.team.delete({ where: { id: teamId } }).catch(() => undefined);
    }
    if (tournamentId) {
      await prisma.tournament.delete({ where: { id: tournamentId } }).catch(() => undefined);
    }
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
