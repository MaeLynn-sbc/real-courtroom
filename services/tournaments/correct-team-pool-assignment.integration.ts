/**
 * Owner request (2026-08-13): "can i hva a pool players list. edit it
 * and change it" — real incident: a live tournament's pools were drawn
 * before poolPosition existed, leaving every team with no number, and
 * with a bracket already generated there was no way back in through
 * setTeamPool (correctly refuses once matches exist). This proves
 * tournamentService.correctTeamPoolAssignment against real rows:
 *
 *   1. Corrects a confirmed team's poolLabel + poolPosition together.
 *   2. Clears both back to unassigned together.
 *   3. Refuses a mismatched pair (one set, the other null).
 *   4. Refuses a non-positive/non-integer position.
 *   5. Works even once a bracket (real Match rows) already exists for
 *      the category — the one behavior that's the whole point of this
 *      method, unlike setTeamPool.
 *   6. Never touches an already-created Match's own poolLabel.
 *   7. Refuses a team that isn't a confirmed registration.
 *   8. Writes a real audit log entry.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
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
    await prisma.sale.deleteMany({ where: { tournamentRegistrationId: { in: registrationIds } } });
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
        name: `Correct Pool Test ${suffix}`,
        startDate: new Date(2031, 9, 12),
        endDate: new Date(2031, 9, 13),
        collectsPaymentOnSite: false,
      },
      owner.id,
    );
    tournamentId = tournament.id;

    const category = await tournamentService.createCategory(
      tournament.id,
      { name: "Test Category", format: "ROUND_ROBIN", division: "OPEN" },
      owner.id,
    );

    const regA = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Correct Pool A ${suffix}` },
      owner.id,
      null,
    );
    const regB = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Correct Pool B ${suffix}` },
      owner.id,
      null,
    );

    // ============== 1. Corrects poolLabel + poolPosition together ==============
    await tournamentService.correctTeamPoolAssignment(category.id, regA.teamId, "A", 3, owner.id);
    let reloaded = await prisma.tournamentRegistration.findUniqueOrThrow({ where: { id: regA.id } });
    assert(reloaded.poolLabel === "A", `expected poolLabel "A", got ${reloaded.poolLabel}`);
    assert(reloaded.poolPosition === 3, `expected poolPosition 3 (an explicit, non-auto-appended value), got ${reloaded.poolPosition}`);
    console.log("PASS: correctTeamPoolAssignment sets an exact, explicit poolLabel + poolPosition together.");

    // ============== 2. Clears both together ==============
    await tournamentService.correctTeamPoolAssignment(category.id, regA.teamId, null, null, owner.id);
    reloaded = await prisma.tournamentRegistration.findUniqueOrThrow({ where: { id: regA.id } });
    assert(reloaded.poolLabel === null, `expected poolLabel cleared to null, got ${reloaded.poolLabel}`);
    assert(reloaded.poolPosition === null, `expected poolPosition cleared to null, got ${reloaded.poolPosition}`);
    console.log("PASS: correctTeamPoolAssignment clears poolLabel + poolPosition back to unassigned together.");

    // ============== 3. Refuses a mismatched pair ==============
    let rejectedMismatchA = false;
    try {
      await tournamentService.correctTeamPoolAssignment(category.id, regA.teamId, "A", null, owner.id);
    } catch (error) {
      rejectedMismatchA = String(error).includes("must be set together");
    }
    assert(rejectedMismatchA, "expected a poolLabel with no poolPosition to be rejected");

    let rejectedMismatchB = false;
    try {
      await tournamentService.correctTeamPoolAssignment(category.id, regA.teamId, null, 1, owner.id);
    } catch (error) {
      rejectedMismatchB = String(error).includes("must be set together");
    }
    assert(rejectedMismatchB, "expected a poolPosition with no poolLabel to be rejected");
    console.log("PASS: correctTeamPoolAssignment refuses a mismatched pool/position pair.");

    // ============== 4. Refuses a non-positive/non-integer position ==============
    let rejectedZero = false;
    try {
      await tournamentService.correctTeamPoolAssignment(category.id, regA.teamId, "A", 0, owner.id);
    } catch {
      rejectedZero = true;
    }
    assert(rejectedZero, "expected position 0 to be rejected");

    let rejectedFraction = false;
    try {
      await tournamentService.correctTeamPoolAssignment(category.id, regA.teamId, "A", 1.5, owner.id);
    } catch {
      rejectedFraction = true;
    }
    assert(rejectedFraction, "expected a fractional position to be rejected");
    console.log("PASS: correctTeamPoolAssignment refuses a non-positive or non-integer position.");

    // ============== 5, 6. Works after a bracket exists, without touching the Match ==============
    await tournamentService.correctTeamPoolAssignment(category.id, regA.teamId, "A", 1, owner.id);
    await tournamentService.correctTeamPoolAssignment(category.id, regB.teamId, "A", 2, owner.id);
    await tournamentService.generateBracket(category.id, owner.id);
    const matchBefore = await prisma.match.findFirstOrThrow({ where: { tournamentCategoryId: category.id } });
    assert(matchBefore.poolLabel === "A", `expected the generated match to carry poolLabel "A", got ${matchBefore.poolLabel}`);

    // Now correct regB's pool AFTER the bracket already exists — the one
    // thing setTeamPool cannot do (it refuses once matches exist).
    await tournamentService.correctTeamPoolAssignment(category.id, regB.teamId, "B", 1, owner.id);
    const regBAfter = await prisma.tournamentRegistration.findUniqueOrThrow({ where: { id: regB.id } });
    assert(regBAfter.poolLabel === "B", `expected regB's poolLabel corrected to "B" even after the bracket exists, got ${regBAfter.poolLabel}`);
    console.log("PASS: correctTeamPoolAssignment works even once a bracket already exists for the category.");

    const matchAfter = await prisma.match.findUniqueOrThrow({ where: { id: matchBefore.id } });
    assert(
      matchAfter.poolLabel === "A",
      `expected the already-created match's own poolLabel to remain "A", untouched by regB's later correction, got ${matchAfter.poolLabel}`,
    );
    console.log("PASS: correcting a team's pool never retroactively moves an already-created match to a different pool.");

    // ============== 7. Refuses a non-confirmed/non-existent team ==============
    let rejectedBadTeam = false;
    try {
      await tournamentService.correctTeamPoolAssignment(category.id, "not-a-real-team-id", "A", 1, owner.id);
    } catch (error) {
      rejectedBadTeam = String(error).includes("confirmed registration");
    }
    assert(rejectedBadTeam, "expected correctTeamPoolAssignment to refuse a team that isn't a confirmed registration");
    console.log("PASS: correctTeamPoolAssignment refuses a team that isn't a confirmed registration in this category.");

    // ============== 8. Audit log entry ==============
    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "TournamentRegistration", entityId: regB.id, action: "tournament.pool_assignment_corrected" },
      orderBy: { createdAt: "desc" },
    });
    assert(auditEntry, "expected a tournament.pool_assignment_corrected audit log entry");
    const newValues = auditEntry!.newValues as { poolLabel?: string; poolPosition?: number } | null;
    assert(newValues?.poolLabel === "B", `expected audit newValues.poolLabel "B", got ${JSON.stringify(newValues)}`);
    assert(newValues?.poolPosition === 1, `expected audit newValues.poolPosition 1, got ${JSON.stringify(newValues)}`);
    console.log("PASS: correctTeamPoolAssignment writes a real audit log entry.");

    await cleanUp(tournamentId);
    console.log("\nPASS: tournamentService.correctTeamPoolAssignment proven against real rows.");
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
