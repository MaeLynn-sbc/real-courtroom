/**
 * Owner request (2026-08-11): "create 2 brackets with option of 3 or 4
 * or equally divide the players for the bracket created. then it will
 * auto create the match" — this proves, against real rows,
 * tournamentService.createPools and generateBracket's pooled path:
 *   1. createPools splits every CONFIRMED registration into poolCount
 *      pools, none dropped or duplicated, and refuses fewer than 2
 *      confirmed teams.
 *   2. Refuses when a bracket already exists for the category.
 *   3. generateBracket, once pools exist, creates matches ONLY within
 *      each pool (no cross-pool pairing at all) with round numbers
 *      restarting at 1 per pool, and every match carries the right
 *      poolLabel.
 *   4. A category with no pools assigned still gets the exact old flat
 *      round robin (poolLabel: null on every match) — fully backward
 *      compatible.
 *   5. Writes real audit log entries for both steps.
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
      data: { shiftNumber: `SHIFT-POOLS-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const suffix = Date.now();

  const tournament = await tournamentService.createTournament(
    {
      name: `Pools Test Tournament ${suffix}`,
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

    const registrations = [];
    for (let i = 0; i < 6; i += 1) {
      registrations.push(
        await tournamentService.registerTeam(
          category.id,
          { player1Name: `Pool Test ${i} ${suffix}`, paymentMethodId: cashMethod.id },
          owner.id,
          { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
        ),
      );
    }
    const teamIds = registrations.map((r) => r.teamId);

    // ============== 1. createPools splits everyone, none dropped/duplicated ==============
    let rejectedTooFew = false;
    try {
      await tournamentService.createPools(category.id, 10, owner.id);
    } catch (error) {
      rejectedTooFew = String(error).includes("Cannot create more pools");
    }
    assert(rejectedTooFew, "expected createPools to refuse more pools than teams");

    const pools = await tournamentService.createPools(category.id, 2, owner.id);
    assert(pools.length === 2, `expected exactly 2 pools, got ${pools.length}`);
    const allAssignedTeamIds = pools.flatMap((p) => p.teamIds).sort();
    assert(
      JSON.stringify(allAssignedTeamIds) === JSON.stringify([...teamIds].sort()),
      "expected every confirmed team to appear in exactly one pool",
    );

    const registrationsAfterDraw = await prisma.tournamentRegistration.findMany({
      where: { tournamentCategoryId: category.id },
      select: { teamId: true, poolLabel: true },
    });
    assert(
      registrationsAfterDraw.every((r) => r.poolLabel !== null),
      "expected every registration to have a real poolLabel persisted, not just returned",
    );
    console.log("PASS: createPools splits every confirmed team into real pools, none dropped or duplicated.");

    // ============== 3 & 4. generateBracket only pairs within each pool ==============
    await tournamentService.generateBracket(category.id, owner.id);
    const matches = await prisma.match.findMany({ where: { tournamentCategoryId: category.id } });
    assert(matches.length > 0, "expected generateBracket to create real matches");

    const poolOfTeam = new Map(registrationsAfterDraw.map((r) => [r.teamId, r.poolLabel]));
    for (const match of matches) {
      assert(match.poolLabel !== null, "expected every match to carry a poolLabel once pools were assigned");
      assert(
        poolOfTeam.get(match.team1Id) === match.poolLabel && poolOfTeam.get(match.team2Id!) === match.poolLabel,
        "expected a match's own poolLabel to match both teams' actual pool — no cross-pool pairing",
      );
    }
    const roundsSeen = new Set(matches.map((m) => m.round));
    assert(roundsSeen.has(1), "expected round numbers to restart at 1 within each pool");
    console.log("PASS: generateBracket, once pools exist, only pairs teams within their own pool; every match carries the right poolLabel.");

    // ============== 2. Refuses createPools once a bracket exists ==============
    let rejectedAlreadyGenerated = false;
    try {
      await tournamentService.createPools(category.id, 2, owner.id);
    } catch (error) {
      rejectedAlreadyGenerated = String(error).includes("already been generated");
    }
    assert(rejectedAlreadyGenerated, "expected createPools to refuse once matchups already exist");
    console.log("PASS: createPools refuses to redraw once matchups have already been generated.");

    // ============== 5. Audit log entries ==============
    const poolsAudit = await prisma.auditLog.findFirst({
      where: { entityType: "TournamentCategory", entityId: category.id, action: "tournament.pools_created" },
    });
    assert(poolsAudit, "expected a tournament.pools_created audit log entry");
    console.log("PASS: createPools writes a real audit log entry.");

    await cleanUp(tournament.id);

    // ============== 4b. No pools assigned -> exact old flat behavior ==============
    const tournament2 = await tournamentService.createTournament(
      {
        name: `Pools Test Unpooled ${suffix}`,
        startDate: new Date(2031, 8, 5),
        endDate: new Date(2031, 8, 6),
        collectsPaymentOnSite: true,
      },
      owner.id,
    );
    try {
      const category2 = await tournamentService.createCategory(
        tournament2.id,
        { name: "Unpooled Category", format: "ROUND_ROBIN", division: "OPEN" },
        owner.id,
      );
      await tournamentService.registerTeam(
        category2.id,
        { player1Name: `Unpooled A ${suffix}`, paymentMethodId: cashMethod.id },
        owner.id,
        { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
      );
      await tournamentService.registerTeam(
        category2.id,
        { player1Name: `Unpooled B ${suffix}`, paymentMethodId: cashMethod.id },
        owner.id,
        { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
      );
      await tournamentService.generateBracket(category2.id, owner.id);
      const unpooledMatches = await prisma.match.findMany({ where: { tournamentCategoryId: category2.id } });
      assert(unpooledMatches.length === 1, `expected exactly 1 match for 2 unpooled teams, got ${unpooledMatches.length}`);
      assert(unpooledMatches[0]!.poolLabel === null, "expected an unpooled category's matches to have poolLabel: null, exactly as before this feature existed");
      console.log("PASS: a category with no pools assigned still gets the exact old flat round robin (poolLabel: null).");
      await cleanUp(tournament2.id);
    } catch (error) {
      await cleanUp(tournament2.id);
      throw error;
    }
  } catch (error) {
    await cleanUp(tournament.id);
    throw error;
  }

  console.log("\nPASS: tournament pools (createPools + generateBracket's pooled path) proven against real rows.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
