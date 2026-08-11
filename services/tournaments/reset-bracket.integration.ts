/**
 * Owner request (2026-08-11): "can i remove this after all. these are
 * all trials" — generateBracket refuses to run again while any Match
 * row exists for the category, and there was no way to undo it.
 * resetBracket is the fix: a real delete of Match (and cascade-deleted
 * Score) rows, so a trial bracket can be cleared and regenerated.
 *
 * Follow-up (2026-08-11): "can i delete games after. coz i might be
 * doing mock tournaments for now" — confirmed resetBracket has no
 * status filter at all, so a fully COMPLETED game deletes the same as
 * an untouched SCHEDULED one. Test 2 below actually plays a match out
 * to COMPLETED before resetting, not just a raw Score row.
 *
 * Proves, against real rows, tournamentService.resetBracket:
 *   1. Refuses to reset a category with no bracket generated yet.
 *   2. Actually deletes every Match row for the category — including
 *      one that's genuinely COMPLETED, not just SCHEDULED — and their
 *      Score rows cascade-delete with them.
 *   3. Leaves registrations/teams completely untouched — only the
 *      bracket step is undone, not who's signed up.
 *   4. generateBracket can run again cleanly afterward (proves the
 *      "already generated" guard is really cleared, not just the rows
 *      being gone).
 *   5. Writes a real audit log entry.
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

async function cleanUp(tournamentId: string): Promise<void> {
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
    await prisma.sale.deleteMany({ where: { tournamentRegistrationId: { in: registrationIds } } });
    await prisma.tournamentRegistration.deleteMany({ where: { id: { in: registrationIds } } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    const players = await prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { userId: true },
    });
    await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: players.map((p) => p.userId) } } });
  }
  await prisma.tournamentCategory.deleteMany({ where: { tournamentId } });
  await prisma.tournament.deleteMany({ where: { id: tournamentId } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: ownerEmployee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-RESET-BRACKET-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const suffix = Date.now();

  const tournament = await tournamentService.createTournament(
    {
      name: `Reset Bracket Test Tournament ${suffix}`,
      startDate: new Date(2031, 8, 5),
      endDate: new Date(2031, 8, 6),
      collectsPaymentOnSite: true,
    },
    owner.id,
  );

  try {
    const category = await tournamentService.createCategory(
      tournament.id,
      { name: "Test Category", format: "ROUND_ROBIN", division: "OPEN" },
      owner.id,
    );

    // ============== 1. Refuses to reset a category with no bracket ==============
    let rejectedNoBracket = false;
    try {
      await tournamentService.resetBracket(category.id, owner.id);
    } catch (error) {
      rejectedNoBracket = true;
      assert(String(error).includes("no bracket"), `expected a "no bracket" error, got ${error}`);
    }
    assert(rejectedNoBracket, "expected resetBracket to refuse a category with no bracket generated yet");
    console.log("PASS: resetBracket refuses a category with no bracket generated yet.");

    // Register 3 teams and generate a real bracket.
    const regA = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Reset Test A ${suffix}`, paymentMethodId: cashMethod.id },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
    );
    const regB = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Reset Test B ${suffix}`, paymentMethodId: cashMethod.id },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
    );
    const regC = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Reset Test C ${suffix}`, paymentMethodId: cashMethod.id },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
    );

    await tournamentService.generateBracket(category.id, owner.id);
    const matchesBefore = await prisma.match.findMany({ where: { tournamentCategoryId: category.id } });
    assert(matchesBefore.length > 0, "expected generateBracket to create real Match rows");

    // Owner report (2026-08-11): "can i delete games after. coz i might
    // be doing mock tournaments for now" — actually PLAY one match out
    // to COMPLETED (not just leave a raw Score row lying around), to
    // prove resetBracket really does delete a finished game too, not
    // only untouched SCHEDULED ones.
    const firstMatch = matchesBefore[0]!;
    await matchService.recordScore(firstMatch.id, { setNumber: 1, team1Score: 11, team2Score: 5 }, owner.id);
    const completed = await matchService.completeMatch(firstMatch.id, owner.id);
    assert(completed.status === "COMPLETED", `expected the match to actually be COMPLETED, got ${completed.status}`);
    const scoresBefore = await prisma.score.count({ where: { matchId: firstMatch.id } });
    assert(scoresBefore === 1, "expected a real Score row to exist before reset");

    // ============== 2 & 3. Reset deletes matches/scores (even a COMPLETED game), leaves registrations alone ==============
    await tournamentService.resetBracket(category.id, owner.id);
    const matchesAfter = await prisma.match.count({ where: { tournamentCategoryId: category.id } });
    assert(matchesAfter === 0, `expected 0 matches after reset (including the COMPLETED one), got ${matchesAfter}`);
    const scoresAfter = await prisma.score.count({ where: { matchId: firstMatch.id } });
    assert(scoresAfter === 0, "expected the Score row to cascade-delete with its Match");

    const registrationsAfter = await prisma.tournamentRegistration.findMany({
      where: { tournamentCategoryId: category.id },
    });
    assert(
      registrationsAfter.length === 3 &&
        registrationsAfter.every((r) => r.status === "CONFIRMED") &&
        [regA.id, regB.id, regC.id].every((id) => registrationsAfter.some((r) => r.id === id)),
      "expected all 3 registrations to remain untouched (still CONFIRMED) after resetting the bracket",
    );
    console.log(
      "PASS: resetBracket deletes every Match (and cascade-deleted Score) row, leaving registrations untouched.",
    );

    // ============== 4. generateBracket can run again cleanly ==============
    await tournamentService.generateBracket(category.id, owner.id);
    const matchesRegenerated = await prisma.match.count({ where: { tournamentCategoryId: category.id } });
    assert(matchesRegenerated > 0, "expected generateBracket to succeed again after a reset");
    console.log("PASS: generateBracket runs again cleanly after a reset (the 'already generated' guard is really cleared).");

    // ============== 5. Audit log entry ==============
    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "TournamentCategory", entityId: category.id, action: "tournament.bracket_reset" },
    });
    assert(auditEntry, "expected a tournament.bracket_reset audit log entry");
    console.log("PASS: resetBracket writes a real audit log entry.");

    await cleanUp(tournament.id);
  } catch (error) {
    await cleanUp(tournament.id);
    throw error;
  }

  console.log("\nPASS: resetBracket proven against real rows — refuses when empty, real delete, regenerable.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
