/**
 * TournamentCategory.maxTeams — settable AFTER category creation.
 * Reported live: createCategory's own maxTeams input is optional, and
 * there was no way back to it once a category already existed (staff
 * landed on the category detail page with no option to set it at all).
 *
 * Proves, against real rows:
 *   1. A category created with no maxTeams reads null.
 *   2. Setting it to a real number is picked up by the NEXT registration
 *      (crosses from CONFIRMED to WAITLISTED once the limit is hit) —
 *      the exact enforcement path (registerTeam) this was built to feed.
 *   3. Raising the limit afterward is NOT retroactive — an
 *      already-WAITLISTED registration stays WAITLISTED; only the next
 *      NEW registration sees the raised limit.
 *   4. Clearing it back to blank is a real two-way write (stored as
 *      null, not an empty/zero value) — unlimited teams again.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { playerService } from "../player/player.service";
import { tournamentService } from "./tournament.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(tournamentId: string, playerIds: string[]): Promise<void> {
  const category = await prisma.tournamentCategory.findFirst({ where: { tournamentId } });
  if (category) {
    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentCategoryId: category.id },
      select: { id: true, teamId: true },
    });
    const registrationIds = registrations.map((r) => r.id);
    const teamIds = registrations.map((r) => r.teamId);
    await prisma.sale.deleteMany({ where: { tournamentRegistrationId: { in: registrationIds } } });
    await prisma.tournamentRegistration.deleteMany({ where: { id: { in: registrationIds } } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
  }
  await prisma.tournamentCategory.deleteMany({ where: { tournamentId } });
  await prisma.tournament.deleteMany({ where: { id: tournamentId } });
  const players = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: { userId: true },
  });
  await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: players.map((p) => p.userId) } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({
    where: { employeeId: ownerEmployee.id, status: "OPEN" },
  });
  if (!shift) {
    shift = await prisma.shift.create({
      data: {
        shiftNumber: `SHIFT-MAXTEAMS-${Date.now()}`,
        employeeId: ownerEmployee.id,
        status: "OPEN",
      },
    });
  }
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

  const playerIds: string[] = [];
  async function makePlayer(label: string): Promise<string> {
    const player = await playerService.createPlayer(
      {
        name: `MaxTeams Test ${label}`,
        email: `maxteams-${label.toLowerCase()}-${Date.now()}@example.test`,
      },
      owner.id,
    );
    playerIds.push(player.id);
    return player.id;
  }

  const tournament = await tournamentService.createTournament(
    {
      name: `MaxTeams Test Tournament ${Date.now()}`,
      startDate: new Date(2031, 8, 1),
      endDate: new Date(2031, 8, 2),
    },
    owner.id,
  );

  try {
    const category = await tournamentService.createCategory(
      tournament.id,
      { name: "Test Category", format: "ROUND_ROBIN", division: "OPEN" },
      owner.id,
    );

    // 1. No maxTeams set at creation reads null.
    const freshCategory = await prisma.tournamentCategory.findUniqueOrThrow({
      where: { id: category.id },
    });
    assert(
      freshCategory.maxTeams === null,
      `expected a category created with no maxTeams to read null, got ${freshCategory.maxTeams}`,
    );
    console.log("PASS: a category created with no maxTeams reads null.");

    // 2. Set it to 1 — the NEXT registration enforces it.
    await tournamentService.updateCategoryMaxTeams(category.id, 1, owner.id);
    const afterSet = await prisma.tournamentCategory.findUniqueOrThrow({
      where: { id: category.id },
    });
    assert(afterSet.maxTeams === 1, `expected maxTeams to be set to 1, got ${afterSet.maxTeams}`);

    const playerA = await makePlayer("A");
    const regA = await tournamentService.registerTeam(
      category.id,
      { player1Id: playerA, paymentMethodId: cashMethod.id },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
    );
    assert(
      regA.status === "CONFIRMED",
      `expected the first team to be CONFIRMED under a limit of 1, got ${regA.status}`,
    );

    const playerB = await makePlayer("B");
    const regB = await tournamentService.registerTeam(
      category.id,
      { player1Id: playerB, paymentMethodId: cashMethod.id },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
    );
    assert(
      regB.status === "WAITLISTED",
      `expected the second team to be WAITLISTED once the limit of 1 is hit, got ${regB.status}`,
    );
    console.log(
      "PASS: setting maxTeams is enforced by the next registration — 1st CONFIRMED, 2nd WAITLISTED.",
    );

    // 3. Raising the limit afterward is NOT retroactive.
    await tournamentService.updateCategoryMaxTeams(category.id, 2, owner.id);
    const regBAfterRaise = await prisma.tournamentRegistration.findUniqueOrThrow({
      where: { id: regB.id },
    });
    assert(
      regBAfterRaise.status === "WAITLISTED",
      `expected the already-WAITLISTED registration to stay WAITLISTED after raising the limit, got ${regBAfterRaise.status}`,
    );
    console.log(
      "PASS: raising the limit does not retroactively re-confirm an already-WAITLISTED registration.",
    );

    // ...but the NEXT new registration sees the raised limit.
    const playerC = await makePlayer("C");
    const regC = await tournamentService.registerTeam(
      category.id,
      { player1Id: playerC, paymentMethodId: cashMethod.id },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
    );
    assert(
      regC.status === "CONFIRMED",
      `expected a NEW registration to see the raised limit (1 confirmed so far, limit now 2), got ${regC.status}`,
    );
    console.log("PASS: a new registration after raising the limit correctly sees the new value.");

    // 4. Clearing it back to blank is a real two-way write.
    await tournamentService.updateCategoryMaxTeams(category.id, null, owner.id);
    const afterClear = await prisma.tournamentCategory.findUniqueOrThrow({
      where: { id: category.id },
    });
    assert(
      afterClear.maxTeams === null,
      `expected clearing to store null (unlimited), got ${afterClear.maxTeams}`,
    );
    console.log(
      "PASS: clearing maxTeams is a real two-way write back to null (unlimited), not a one-way set.",
    );

    const auditEntries = await prisma.auditLog.findMany({
      where: {
        entityType: "TournamentCategory",
        entityId: category.id,
        action: "tournament.category_max_teams_updated",
      },
    });
    assert(
      auditEntries.length === 3,
      `expected 3 audit log entries (set 1, raise to 2, clear), got ${auditEntries.length}`,
    );
    console.log("PASS: every maxTeams change is audit-logged.");

    await cleanUp(tournament.id, playerIds);
  } catch (error) {
    await cleanUp(tournament.id, playerIds);
    throw error;
  }

  console.log(
    "\nPASS: TournamentCategory.maxTeams settable after creation, proven against real rows.",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
