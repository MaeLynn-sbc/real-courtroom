/**
 * Owner request (2026-08-11): "i want to edit and manually add teams.
 * as what ive said. teams will be drawn by wheel of fortune for
 * fairness" — createPools' random shuffle is a starting point only;
 * this proves the one-team-at-a-time manual override, against real
 * rows.
 *
 * Proves tournamentService.setTeamPool:
 *   1. Assigns a confirmed team to a pool, persisted.
 *   2. Moves a team already in one pool to a different pool (override,
 *      not additive).
 *   3. Clears a team back to unassigned (poolLabel: null).
 *   4. Refuses a team that isn't a CONFIRMED registration in this
 *      category.
 *   5. Refuses once a bracket has already been generated.
 *   6. Writes a real audit log entry with before/after values.
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
      data: { shiftNumber: `SHIFT-SET-TEAM-POOL-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const suffix = Date.now();

  const tournament = await tournamentService.createTournament(
    {
      name: `Set Team Pool Test ${suffix}`,
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

    const regA = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Set Pool A ${suffix}`, paymentMethodId: cashMethod.id },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
    );
    const regB = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Set Pool B ${suffix}`, paymentMethodId: cashMethod.id },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
    );

    // ============== 1. Assigns a team to a pool ==============
    await tournamentService.setTeamPool(category.id, regA.teamId, "A", owner.id);
    let reloaded = await prisma.tournamentRegistration.findUniqueOrThrow({ where: { id: regA.id } });
    assert(reloaded.poolLabel === "A", `expected poolLabel "A", got ${reloaded.poolLabel}`);
    console.log("PASS: setTeamPool assigns a confirmed team to a pool, persisted.");

    // ============== 2. Moves a team to a different pool ==============
    await tournamentService.setTeamPool(category.id, regA.teamId, "B", owner.id);
    reloaded = await prisma.tournamentRegistration.findUniqueOrThrow({ where: { id: regA.id } });
    assert(reloaded.poolLabel === "B", `expected poolLabel to move to "B", got ${reloaded.poolLabel}`);
    console.log("PASS: setTeamPool moves a team already in one pool to a different pool.");

    // ============== 3. Clears back to unassigned ==============
    await tournamentService.setTeamPool(category.id, regA.teamId, null, owner.id);
    reloaded = await prisma.tournamentRegistration.findUniqueOrThrow({ where: { id: regA.id } });
    assert(reloaded.poolLabel === null, `expected poolLabel to clear to null, got ${reloaded.poolLabel}`);
    console.log("PASS: setTeamPool clears a team back to unassigned.");

    // ============== 4. Refuses a non-confirmed/non-existent team ==============
    let rejectedBadTeam = false;
    try {
      await tournamentService.setTeamPool(category.id, "not-a-real-team-id", "A", owner.id);
    } catch (error) {
      rejectedBadTeam = String(error).includes("confirmed registration");
    }
    assert(rejectedBadTeam, "expected setTeamPool to refuse a team that isn't a confirmed registration");
    console.log("PASS: setTeamPool refuses a team that isn't a confirmed registration in this category.");

    // ============== 6. Audit log entry (checked before bracket exists) ==============
    await tournamentService.setTeamPool(category.id, regA.teamId, "A", owner.id);
    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "TournamentRegistration", entityId: regA.id, action: "tournament.team_pool_changed" },
      orderBy: { createdAt: "desc" },
    });
    assert(auditEntry, "expected a tournament.team_pool_changed audit log entry");
    const newValues = auditEntry!.newValues as { poolLabel?: string } | null;
    assert(newValues?.poolLabel === "A", `expected audit newValues.poolLabel "A", got ${JSON.stringify(newValues)}`);
    console.log("PASS: setTeamPool writes a real audit log entry.");

    // ============== 5. Refuses once a bracket exists ==============
    // Both teams need a pool before generateBracket's pooled path will
    // run at all — set regB's too so this step tests only the "bracket
    // already exists" guard, not the separate partial-pool guard.
    await tournamentService.setTeamPool(category.id, regB.teamId, "A", owner.id);
    await tournamentService.generateBracket(category.id, owner.id);
    let rejectedAfterBracket = false;
    try {
      await tournamentService.setTeamPool(category.id, regB.teamId, "A", owner.id);
    } catch (error) {
      rejectedAfterBracket = String(error).includes("already been generated");
    }
    assert(rejectedAfterBracket, "expected setTeamPool to refuse once a bracket has been generated");
    console.log("PASS: setTeamPool refuses once matchups have already been generated.");

    await cleanUp(tournament.id);
  } catch (error) {
    await cleanUp(tournament.id);
    throw error;
  }

  console.log("\nPASS: tournamentService.setTeamPool proven against real rows.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
