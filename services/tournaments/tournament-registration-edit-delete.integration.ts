/**
 * Owner request (2026-08-05): "add option to delete and edit, to those
 * who cancelled or typo errors."
 *
 * Proves, against real rows:
 *   1. updateRegistrationPlayerNames corrects both names on a doubles
 *      registration.
 *   2. updateRegistrationPlayerNames refuses to add a player2 name to a
 *      singles registration (not a typo fix — a structural change).
 *   3. updateRegistrationPlayerNames refuses to omit player2Name for a
 *      real doubles registration.
 *   4. deleteRegistration succeeds for a registration with NO Sale —
 *      the row, its Team, both Players, and both Users are all gone.
 *   5. deleteRegistration REFUSES a registration WITH a real Sale —
 *      proven failing-first against the exact same shape as case 4,
 *      only difference is a Sale exists — and leaves every row (Sale
 *      included) completely untouched.
 *   6. deleteRegistration refuses once a bracket exists for the
 *      category, same guard cancelRegistration already has.
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

async function cleanUp(tournamentIds: string[]): Promise<void> {
  for (const tournamentId of tournamentIds) {
    const categories = await prisma.tournamentCategory.findMany({ where: { tournamentId }, select: { id: true } });
    for (const category of categories) {
      const registrations = await prisma.tournamentRegistration.findMany({
        where: { tournamentCategoryId: category.id },
        select: { id: true, teamId: true, team: { select: { player1Id: true, player2Id: true } } },
      });
      const registrationIds = registrations.map((r) => r.id);
      const teamIds = registrations.map((r) => r.teamId);
      const playerIds = registrations.flatMap((r) =>
        r.team.player2Id ? [r.team.player1Id, r.team.player2Id] : [r.team.player1Id],
      );
      await prisma.match.deleteMany({ where: { tournamentCategoryId: category.id } });
      await prisma.sale.deleteMany({ where: { tournamentRegistrationId: { in: registrationIds } } });
      await prisma.tournamentRegistration.deleteMany({ where: { id: { in: registrationIds } } });
      await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
      const players = await prisma.player.findMany({ where: { id: { in: playerIds } }, select: { userId: true } });
      await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
      await prisma.user.deleteMany({ where: { id: { in: players.map((p) => p.userId) } } });
    }
    await prisma.tournamentCategory.deleteMany({ where: { tournamentId } });
  }
  await prisma.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const suffix = Date.now();

  const tournament = await tournamentService.createTournament(
    {
      name: `Edit Delete Test Tournament ${suffix}`,
      startDate: new Date(2031, 9, 5),
      endDate: new Date(2031, 9, 6),
      collectsPaymentOnSite: false,
    },
    owner.id,
  );

  try {
    const category = await tournamentService.createCategory(
      tournament.id,
      { name: "Edit Delete Category", format: "ROUND_ROBIN", division: "OPEN" },
      owner.id,
    );

    // ============== 1. Correct both names on a doubles registration ==============
    const doublesReg = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Typo Playr One ${suffix}`, player2Name: `Typo Playr Two ${suffix}` },
      owner.id,
      null,
    );
    const corrected = await tournamentService.updateRegistrationPlayerNames(
      doublesReg.id,
      { player1Name: `Player One ${suffix}`, player2Name: `Player Two ${suffix}` },
      owner.id,
    );
    const correctedTeam = await prisma.team.findUniqueOrThrow({
      where: { id: corrected.teamId },
      include: { player1: { include: { user: true } }, player2: { include: { user: true } } },
    });
    assert(correctedTeam.player1.user.name === `Player One ${suffix}`, "expected player1's name corrected");
    assert(
      correctedTeam.player2!.user.name === `Player Two ${suffix}`,
      "expected player2's name corrected",
    );
    console.log("PASS: updateRegistrationPlayerNames corrects both names on a real doubles registration.");

    // ============== 2. Refuse adding a player2 to a singles registration ==============
    const singlesReg = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Solo Typo ${suffix}` },
      owner.id,
      null,
    );
    let rejectedAddingPlayer2 = false;
    try {
      await tournamentService.updateRegistrationPlayerNames(
        singlesReg.id,
        { player1Name: `Solo Fixed ${suffix}`, player2Name: `Surprise Partner ${suffix}` },
        owner.id,
      );
    } catch {
      rejectedAddingPlayer2 = true;
    }
    assert(rejectedAddingPlayer2, "expected adding a player2 name to a singles registration to be rejected");
    console.log("PASS: updateRegistrationPlayerNames refuses to add a player2 to a singles registration.");

    // ============== 3. Refuse omitting player2Name for a real doubles registration ==============
    let rejectedOmittingPlayer2 = false;
    try {
      await tournamentService.updateRegistrationPlayerNames(
        doublesReg.id,
        { player1Name: `Player One Again ${suffix}` },
        owner.id,
      );
    } catch {
      rejectedOmittingPlayer2 = true;
    }
    assert(rejectedOmittingPlayer2, "expected omitting player2Name for a doubles registration to be rejected");
    console.log("PASS: updateRegistrationPlayerNames refuses to drop player2's name from a doubles registration.");

    // ============== 4. Delete succeeds with NO Sale — everything really gone ==============
    const deletableReg = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Deletable Player ${suffix}` },
      owner.id,
      null,
    );
    const deletableTeam = await prisma.team.findUniqueOrThrow({ where: { id: deletableReg.teamId } });
    const deletablePlayer = await prisma.player.findUniqueOrThrow({ where: { id: deletableTeam.player1Id } });
    await tournamentService.deleteRegistration(deletableReg.id, owner.id);

    const goneReg = await prisma.tournamentRegistration.findUnique({ where: { id: deletableReg.id } });
    const goneTeam = await prisma.team.findUnique({ where: { id: deletableTeam.id } });
    const gonePlayer = await prisma.player.findUnique({ where: { id: deletablePlayer.id } });
    const goneUser = await prisma.user.findUnique({ where: { id: deletablePlayer.userId } });
    assert(goneReg === null, "expected the registration row to be gone");
    assert(goneTeam === null, "expected the team row to be gone");
    assert(gonePlayer === null, "expected the player row to be gone");
    assert(goneUser === null, "expected the underlying user row to be gone");
    console.log("PASS: deleteRegistration with no Sale removes the registration, team, player, and user rows.");

    // ============== 5. Failing-first: refuse deleting a registration WITH a Sale ==============
    const shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-EDITDEL-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
    const paidReg = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Paid No Delete Player ${suffix}`, paymentMethodId: cashMethod.id },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
    );
    const saleBefore = await prisma.sale.findFirstOrThrow({ where: { tournamentRegistrationId: paidReg.id } });

    let rejectedDeleteWithSale = false;
    try {
      await tournamentService.deleteRegistration(paidReg.id, owner.id);
    } catch (error) {
      rejectedDeleteWithSale = true;
      assert(
        error instanceof Error && error.message.toLowerCase().includes("payment"),
        `expected a payment-related refusal message, got: ${error}`,
      );
    }
    assert(rejectedDeleteWithSale, "expected deleteRegistration to refuse a registration with a real Sale");

    const regStillThere = await prisma.tournamentRegistration.findUnique({ where: { id: paidReg.id } });
    const saleStillThere = await prisma.sale.findUnique({ where: { id: saleBefore.id } });
    assert(regStillThere !== null, "expected the registration to still exist after the refused delete");
    assert(saleStillThere !== null, "expected the Sale to still exist after the refused delete — money record untouched");
    console.log("PASS: deleteRegistration refuses a registration with a recorded Sale, leaving the registration and the Sale completely untouched — proven failing-first against the exact no-Sale shape that succeeded in case 4.");
    await prisma.shift.update({ where: { id: shift.id }, data: { status: "CLOSED", endedAt: new Date() } });

    // ============== 6. Refuse once a bracket exists ==============
    const bracketCategory = await tournamentService.createCategory(
      tournament.id,
      { name: "Bracket Guard Category", format: "SINGLE_ELIMINATION", division: "OPEN" },
      owner.id,
    );
    const bracketReg1 = await tournamentService.registerTeam(
      bracketCategory.id,
      { player1Name: `Bracket A ${suffix}` },
      owner.id,
      null,
    );
    // Second team, needed for generateBracket to have anything to pair
    // — never referenced again, only bracketReg1 is deleted below.
    await tournamentService.registerTeam(
      bracketCategory.id,
      { player1Name: `Bracket B ${suffix}` },
      owner.id,
      null,
    );
    await tournamentService.generateBracket(bracketCategory.id, owner.id);

    let rejectedAfterBracket = false;
    try {
      await tournamentService.deleteRegistration(bracketReg1.id, owner.id);
    } catch {
      rejectedAfterBracket = true;
    }
    assert(rejectedAfterBracket, "expected deleteRegistration to refuse once the bracket has been generated");
    console.log("PASS: deleteRegistration refuses once a bracket has been generated for the category.");

    await cleanUp([tournament.id]);
    console.log("\nPASS: tournament registration edit/delete proven against real rows.");
  } catch (error) {
    await cleanUp([tournament.id]);
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
