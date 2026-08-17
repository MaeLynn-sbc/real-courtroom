/**
 * Owner request (2026-08-17): "also add edit in the scorecards" — a
 * finished match's score could not be corrected at all (the inputs were
 * disabled once status became COMPLETED).
 *
 * Simply unlocking them would have been worse than leaving them locked:
 * winnerTeamId is frozen by completeMatch and never recomputed, so a
 * corrected score would have sat under the OLD winner on the public
 * bracket indefinitely. Hence a guarded correction path.
 *
 * Proves, against real rows:
 *   1. A correction that keeps the same winner is allowed, and the stored
 *      score really changes (the ordinary "11-9 should have been 11-8").
 *   2. A correction that FLIPS the winner is allowed while nothing has
 *      been built on the result, and winnerTeamId is recomputed.
 *   3. A correction that would flip the winner is REFUSED once the next
 *      round exists — and the rejected score is rolled back, not left
 *      persisted under the old winner.
 *   4. A correction leaving no decisive result is refused.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
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

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const teamIds: string[] = [];
  let tournamentId: string | null = null;
  const categoryIds: string[] = [];

  try {
    const tournament = await tournamentService.createTournament(
      {
        name: `Score Correction Test ${Date.now()}`,
        startDate: new Date(2026, 0, 1),
        endDate: new Date(2026, 0, 1),
        collectsPaymentOnSite: false,
      },
      owner.id,
    );
    tournamentId = tournament.id;

    const category = await tournamentService.createCategory(
      tournament.id,
      { name: "Knockout", format: "SINGLE_ELIMINATION", division: "OPEN" },
      owner.id,
    );
    categoryIds.push(category.id);

    for (let i = 0; i < 4; i += 1) {
      teamIds.push(await makeTeam(`SC-${Date.now()}-${i}`));
    }

    async function freshCompletedMatch(position: number, winnerIndex: 0 | 1) {
      const a = teamIds[position * 2];
      const b = teamIds[position * 2 + 1];
      const match = await prisma.match.create({
        data: {
          tournamentCategoryId: category.id,
          round: 1,
          bracketPosition: position,
          team1Id: a,
          team2Id: b,
          status: "SCHEDULED",
        },
      });
      // 11-5 to team1 (or reversed) then complete.
      await matchService.recordScore(
        match.id,
        { setNumber: 1, team1Score: winnerIndex === 0 ? 11 : 5, team2Score: winnerIndex === 0 ? 5 : 11 },
        owner.id,
      );
      await matchService.completeMatch(match.id, owner.id);
      return { match, a, b };
    }

    // ============== 1. Same winner — allowed, score really changes ==============
    const { match: m1, a: t1a } = await freshCompletedMatch(0, 0);
    await matchService.recordScore(m1.id, { setNumber: 1, team1Score: 11, team2Score: 8 }, owner.id);
    const afterTweak = await prisma.match.findUniqueOrThrow({
      where: { id: m1.id },
      include: { scores: true },
    });
    assert(
      afterTweak.scores[0].team2Score === 8,
      `expected the corrected score to persist, got ${afterTweak.scores[0].team2Score}`,
    );
    assert(
      afterTweak.winnerTeamId === t1a,
      "expected the winner to be unchanged by a correction that doesn't flip the result",
    );
    assert(afterTweak.status === "COMPLETED", "expected the match to stay COMPLETED");
    console.log("PASS: correcting a completed match's score keeps it completed and persists the new score.");

    // ============== 2. Winner flips — allowed while nothing was built on it ==============
    const flipped = await matchService.recordScore(
      m1.id,
      { setNumber: 1, team1Score: 7, team2Score: 11 },
      owner.id,
    );
    assert(flipped.team2Score === 11, "expected the flipping correction to be written");
    const afterFlip = await prisma.match.findUniqueOrThrow({ where: { id: m1.id } });
    assert(
      afterFlip.winnerTeamId !== t1a && afterFlip.winnerTeamId !== null,
      `expected the winner to be recomputed to the other team, got ${afterFlip.winnerTeamId}`,
    );
    const auditEntry = await prisma.auditLog.findFirst({
      where: {
        entityType: "Match",
        entityId: m1.id,
        action: "tournament.completed_match_score_corrected",
      },
    });
    assert(auditEntry, "expected the correction to be audit-logged");
    console.log("PASS: a correction that flips the winner recomputes winnerTeamId, and is audit-logged.");

    // ============== 3. Refused once the next round exists — and rolled back ==============
    // Complete the sibling so the final gets created from both winners.
    const { match: m2 } = await freshCompletedMatch(1, 0);
    const finalMatch = await prisma.match.findFirst({
      where: { tournamentCategoryId: category.id, round: 2, bracketPosition: 0 },
    });
    assert(finalMatch, "fixture check: expected the final to have been created from the two winners");

    const beforeRefusal = await prisma.match.findUniqueOrThrow({
      where: { id: m2.id },
      include: { scores: true },
    });
    let refused = false;
    try {
      await matchService.recordScore(m2.id, { setNumber: 1, team1Score: 4, team2Score: 11 }, owner.id);
    } catch (error) {
      refused = true;
      assert(
        String(error).includes("next round has already been created"),
        `expected an already-advanced error, got ${error}`,
      );
    }
    assert(refused, "expected a winner-flipping correction to be refused once the next round exists");

    const afterRefusal = await prisma.match.findUniqueOrThrow({
      where: { id: m2.id },
      include: { scores: true },
    });
    assert(
      afterRefusal.winnerTeamId === beforeRefusal.winnerTeamId,
      "expected the winner to be untouched after a refused correction",
    );
    assert(
      afterRefusal.scores[0].team1Score === beforeRefusal.scores[0].team1Score &&
        afterRefusal.scores[0].team2Score === beforeRefusal.scores[0].team2Score,
      "expected the REJECTED score to be rolled back, not left persisted under the old winner",
    );
    console.log("PASS: refused once the next round exists — and the rejected score is rolled back.");

    // A correction that does NOT flip the winner is still fine on that same
    // advanced match — it's only the flip that's dangerous.
    await matchService.recordScore(m2.id, { setNumber: 1, team1Score: 11, team2Score: 9 }, owner.id);
    const afterSafeEdit = await prisma.match.findUniqueOrThrow({
      where: { id: m2.id },
      include: { scores: true },
    });
    assert(
      afterSafeEdit.scores[0].team2Score === 9,
      "expected a non-flipping correction to still be allowed on an advanced match",
    );
    console.log("PASS: a non-flipping correction is still allowed even after the next round exists.");

    // ============== 4. No decisive result — refused ==============
    let tieRefused = false;
    try {
      await matchService.recordScore(m2.id, { setNumber: 1, team1Score: 9, team2Score: 9 }, owner.id);
    } catch (error) {
      tieRefused = true;
      assert(
        String(error).includes("decisive"),
        `expected a not-decisive error, got ${error}`,
      );
    }
    assert(tieRefused, "expected a correction leaving no decisive result to be refused");
    console.log("PASS: a correction leaving no decisive winner is refused.");

    console.log("\nPASS: completed-match score correction proven against real rows.");
  } finally {
    for (const categoryId of categoryIds) {
      await prisma.match.deleteMany({ where: { tournamentCategoryId: categoryId } });
      await prisma.tournamentCategory.delete({ where: { id: categoryId } }).catch(() => undefined);
    }
    for (const teamId of teamIds) {
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
