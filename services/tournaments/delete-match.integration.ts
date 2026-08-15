/**
 * Owner request (2026-08-15), LIVE during the Sayans and Friends
 * tournament: "manual match ups and auto match ups. kindly make a
 * button or option to delete" — matchService.deleteMatch is the single
 * delete path for both a manually-created match (createManualMatch,
 * tournament.service.ts) and an auto bracket-generated one
 * (generateBracket).
 *
 * Proves, against real rows:
 *   1. A manually-created match (never has a bracketPosition) deletes
 *      cleanly, its Score cascade-deletes, and a real audit log entry
 *      is written.
 *   2. A Round Robin match (has a round but no bracketPosition, so
 *      never participates in bracket advancement) deletes cleanly
 *      regardless of status.
 *   3. A Single Elimination round-1 match that hasn't advanced yet
 *      (no round-2 match created for its slot) deletes cleanly.
 *   4. A Single Elimination round-1 match that HAS already fed
 *      tryAdvanceBracket's round-2 creation is refused — deleting it
 *      would leave the round-2 match's slot pointing at nothing, and
 *      that branch of the bracket could never be recomputed correctly.
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
  const suffix = Date.now();

  let tournamentId: string | null = null;
  try {
    const tournament = await tournamentService.createTournament(
      {
        name: `Delete Match Test Tournament ${suffix}`,
        startDate: new Date(2031, 10, 1),
        endDate: new Date(2031, 10, 2),
        collectsPaymentOnSite: false,
      },
      owner.id,
    );
    tournamentId = tournament.id;

    // ============== 1. A manual match deletes cleanly ==============
    const manualCategory = await tournamentService.createCategory(
      tournament.id,
      { name: "Manual Delete Test", format: "ROUND_ROBIN", division: "OPEN" },
      owner.id,
    );
    const manualRegA = await tournamentService.registerTeam(
      manualCategory.id,
      { player1Name: `Manual A ${suffix}` },
      owner.id,
      null,
    );
    const manualRegB = await tournamentService.registerTeam(
      manualCategory.id,
      { player1Name: `Manual B ${suffix}` },
      owner.id,
      null,
    );
    const manualMatch = await tournamentService.createManualMatch(
      manualCategory.id,
      { team1Id: manualRegA.teamId, team2Id: manualRegB.teamId },
      owner.id,
    );
    await matchService.recordScore(manualMatch.id, { setNumber: 1, team1Score: 11, team2Score: 5 }, owner.id);
    const scoresBeforeManualDelete = await prisma.score.count({ where: { matchId: manualMatch.id } });
    assert(scoresBeforeManualDelete === 1, "expected a real Score row to exist before deleting the manual match");

    await matchService.deleteMatch(manualMatch.id, owner.id);
    const manualMatchAfter = await prisma.match.findUnique({ where: { id: manualMatch.id } });
    assert(manualMatchAfter === null, "expected the manual match to actually be deleted");
    const scoresAfterManualDelete = await prisma.score.count({ where: { matchId: manualMatch.id } });
    assert(scoresAfterManualDelete === 0, "expected the manual match's Score to cascade-delete with it");
    const manualAuditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "Match", entityId: manualMatch.id, action: "tournament.match_deleted" },
    });
    assert(manualAuditEntry, "expected a tournament.match_deleted audit log entry for the manual match");
    console.log("PASS: deleteMatch removes a manually-created match, cascade-deletes its Score, and writes a real audit log entry.");

    // ============== 2. A Round Robin match deletes cleanly regardless of status ==============
    const rrCategory = await tournamentService.createCategory(
      tournament.id,
      { name: "Round Robin Delete Test", format: "ROUND_ROBIN", division: "OPEN" },
      owner.id,
    );
    const rrRegA = await tournamentService.registerTeam(rrCategory.id, { player1Name: `RR A ${suffix}` }, owner.id, null);
    const rrRegB = await tournamentService.registerTeam(rrCategory.id, { player1Name: `RR B ${suffix}` }, owner.id, null);
    await tournamentService.generateBracket(rrCategory.id, owner.id);
    const rrMatches = await prisma.match.findMany({ where: { tournamentCategoryId: rrCategory.id } });
    assert(rrMatches.length > 0, "expected generateBracket to create at least one Round Robin match");
    const rrMatch = rrMatches[0]!;
    assert(rrMatch.bracketPosition === null, "expected a Round Robin match to never have a bracketPosition");
    await matchService.recordScore(rrMatch.id, { setNumber: 1, team1Score: 11, team2Score: 5 }, owner.id);
    await matchService.completeMatch(rrMatch.id, owner.id);

    await matchService.deleteMatch(rrMatch.id, owner.id);
    const rrMatchAfter = await prisma.match.findUnique({ where: { id: rrMatch.id } });
    assert(rrMatchAfter === null, "expected the Round Robin match to actually be deleted even though it was COMPLETED");
    console.log("PASS: deleteMatch removes a Round Robin match regardless of status (never blocked by bracket advancement).");
    void rrRegA;
    void rrRegB;

    // ============== 3 & 4. Single Elimination: not-yet-advanced deletes, already-advanced is refused ==============
    const seCategory = await tournamentService.createCategory(
      tournament.id,
      { name: "Single Elim Delete Test", format: "SINGLE_ELIMINATION", division: "OPEN" },
      owner.id,
    );
    const seRegs = [];
    for (let i = 0; i < 4; i += 1) {
      seRegs.push(
        await tournamentService.registerTeam(seCategory.id, { player1Name: `SE Team ${i} ${suffix}` }, owner.id, null),
      );
    }
    await tournamentService.generateBracket(seCategory.id, owner.id);
    const round1Matches = await prisma.match.findMany({
      where: { tournamentCategoryId: seCategory.id, round: 1 },
      orderBy: { bracketPosition: "asc" },
    });
    assert(round1Matches.length === 2, `expected 2 round-1 matches for 4 teams, got ${round1Matches.length}`);

    // 3. Neither round-1 match has advanced yet — deleting one should succeed cleanly.
    const [matchA, matchB] = round1Matches;
    await matchService.deleteMatch(matchA!.id, owner.id);
    const matchAAfter = await prisma.match.findUnique({ where: { id: matchA!.id } });
    assert(matchAAfter === null, "expected a not-yet-advanced Single Elimination match to delete cleanly");
    console.log("PASS: deleteMatch removes a Single Elimination match that hasn't advanced to the next round yet.");

    // Regenerate a clean pair (matchA's deletion above shouldn't be
    // "fixed" by re-running generateBracket — it correctly refuses once
    // any Match exists — so recreate matchA manually as a same-shape
    // stand-in match, sharing matchB's exact round/bracketPosition, to
    // set up test 4 without fighting that guard.
    const matchAReplacement = await prisma.match.create({
      data: {
        tournamentCategoryId: seCategory.id,
        round: matchA!.round,
        bracketPosition: matchA!.bracketPosition,
        team1Id: matchA!.team1Id,
        team2Id: matchA!.team2Id,
        status: "SCHEDULED",
      },
    });

    // 4. Complete both round-1 matches so tryAdvanceBracket creates round 2.
    await matchService.recordScore(matchAReplacement.id, { setNumber: 1, team1Score: 11, team2Score: 5 }, owner.id);
    await matchService.completeMatch(matchAReplacement.id, owner.id);
    await matchService.recordScore(matchB!.id, { setNumber: 1, team1Score: 11, team2Score: 5 }, owner.id);
    await matchService.completeMatch(matchB!.id, owner.id);

    const round2Match = await prisma.match.findFirst({
      where: { tournamentCategoryId: seCategory.id, round: 2 },
    });
    assert(round2Match, "expected completing both round-1 matches to create a real round-2 match");

    let rejectedAlreadyAdvanced = false;
    try {
      await matchService.deleteMatch(matchAReplacement.id, owner.id);
    } catch (error) {
      rejectedAlreadyAdvanced = true;
      assert(
        String(error).includes("already advanced"),
        `expected an "already advanced" error, got ${error}`,
      );
    }
    assert(rejectedAlreadyAdvanced, "expected deleteMatch to refuse a match that already fed round-2 creation");
    const matchAReplacementStillExists = await prisma.match.findUnique({ where: { id: matchAReplacement.id } });
    assert(matchAReplacementStillExists !== null, "expected the refused match to still exist, untouched");
    console.log("PASS: deleteMatch refuses a Single Elimination match that has already advanced to the next round.");
    void seRegs;

    await cleanUp(tournamentId);
    console.log("\nPASS: deleteMatch (manual + auto match-ups) proven against real rows.");
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
