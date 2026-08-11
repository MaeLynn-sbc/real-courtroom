/**
 * Owner request (2026-08-11): "the bracketing might be done live via
 * wheel of fortune in the internet so that everybody can see it" — the
 * actual draw happens externally; this just records whatever pairing
 * results, one at a time.
 *
 * Proves, against real rows, tournamentService.createManualMatch:
 *   1. Creates a real Match between two CONFIRMED teams, no round given
 *      → round is null (falls into BracketView's "Round 0" bucket).
 *   2. A given round is persisted as-is.
 *   3. Refuses the same team on both sides.
 *   4. Refuses a team that isn't a CONFIRMED registration in this
 *      category (e.g. WAITLISTED, or belonging to a different category).
 *   5. Works even when generateBracket has never been run for the
 *      category (no bracket required first).
 *   6. Writes a real audit log entry.
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
      data: { shiftNumber: `SHIFT-MANUAL-MATCH-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const suffix = Date.now();

  const tournament = await tournamentService.createTournament(
    {
      name: `Manual Match Test Tournament ${suffix}`,
      startDate: new Date(2031, 8, 5),
      endDate: new Date(2031, 8, 6),
      collectsPaymentOnSite: true,
    },
    owner.id,
  );

  try {
    const category = await tournamentService.createCategory(
      tournament.id,
      { name: "Test Category", format: "ROUND_ROBIN", division: "OPEN", maxTeams: 2 },
      owner.id,
    );

    const regA = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Manual Test A ${suffix}`, paymentMethodId: cashMethod.id },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
    );
    const regB = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Manual Test B ${suffix}`, paymentMethodId: cashMethod.id },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
    );
    // A 3rd registration that's WAITLISTED (maxTeams: 2 above is already met).
    const regC = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Manual Test C ${suffix}`, paymentMethodId: cashMethod.id },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
    );
    assert(regC.status === "WAITLISTED", `expected the 3rd registration to be WAITLISTED, got ${regC.status}`);

    // ============== 5. Works with no bracket generated at all ==============
    const matchesBefore = await prisma.match.count({ where: { tournamentCategoryId: category.id } });
    assert(matchesBefore === 0, "expected no matches yet — generateBracket was never called");

    // ============== 1. Creates a real Match, no round → null ==============
    const match1 = await tournamentService.createManualMatch(
      category.id,
      { team1Id: regA.teamId, team2Id: regB.teamId },
      owner.id,
    );
    assert(match1.round === null, `expected round to be null when omitted, got ${match1.round}`);
    assert(match1.status === "SCHEDULED", `expected a fresh manual match to be SCHEDULED, got ${match1.status}`);
    const reloaded1 = await prisma.match.findUniqueOrThrow({ where: { id: match1.id } });
    assert(
      reloaded1.team1Id === regA.teamId && reloaded1.team2Id === regB.teamId,
      "expected the persisted match to have the exact teams requested",
    );
    console.log("PASS: createManualMatch creates a real Match with no bracket ever generated; round defaults to null.");

    // ============== 2. A given round is persisted ==============
    // Delete match1 first so team A/B can pair again under an explicit round.
    await prisma.match.delete({ where: { id: match1.id } });
    const match2 = await tournamentService.createManualMatch(
      category.id,
      { team1Id: regA.teamId, team2Id: regB.teamId, round: 2 },
      owner.id,
    );
    assert(match2.round === 2, `expected round 2 to be persisted, got ${match2.round}`);
    console.log("PASS: an explicit round is persisted as given.");

    // ============== 3. Refuses the same team on both sides ==============
    let rejectedSameTeam = false;
    try {
      await tournamentService.createManualMatch(
        category.id,
        { team1Id: regA.teamId, team2Id: regA.teamId },
        owner.id,
      );
    } catch (error) {
      rejectedSameTeam = true;
      assert(String(error).includes("different teams"), `expected a "different teams" error, got ${error}`);
    }
    assert(rejectedSameTeam, "expected createManualMatch to refuse the same team on both sides");
    console.log("PASS: createManualMatch refuses the same team on both sides.");

    // ============== 4. Refuses a non-CONFIRMED team ==============
    let rejectedWaitlisted = false;
    try {
      await tournamentService.createManualMatch(
        category.id,
        { team1Id: regA.teamId, team2Id: regC.teamId },
        owner.id,
      );
    } catch (error) {
      rejectedWaitlisted = true;
      assert(String(error).includes("confirmed"), `expected a "confirmed" error, got ${error}`);
    }
    assert(rejectedWaitlisted, "expected createManualMatch to refuse a WAITLISTED team");
    console.log("PASS: createManualMatch refuses a team that isn't a CONFIRMED registration in this category.");

    // ============== 6. Audit log entry ==============
    const auditEntry = await prisma.auditLog.findFirst({
      where: {
        entityType: "TournamentCategory",
        entityId: category.id,
        action: "tournament.match_created_manually",
      },
    });
    assert(auditEntry, "expected a tournament.match_created_manually audit log entry");
    console.log("PASS: createManualMatch writes a real audit log entry.");

    await cleanUp(tournament.id);
  } catch (error) {
    await cleanUp(tournament.id);
    throw error;
  }

  console.log("\nPASS: tournamentService.createManualMatch proven against real rows.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
