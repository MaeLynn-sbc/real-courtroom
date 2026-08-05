/**
 * "Put tournaments on the homepage once bracketing is done" (owner,
 * 2026-08-04) — the public home-page teaser and /tournaments/[id] page
 * both gate on listPublicTournamentsWithBrackets. Proves, against real
 * rows:
 *   1. A DRAFT tournament (even with a bracketed category) is excluded.
 *   2. A REGISTRATION_OPEN category with no bracket yet is excluded, but
 *      the tournament itself still qualifies once at least ONE other
 *      category has a bracket.
 *   3. Once the tournament is advanced past DRAFT and its category has a
 *      real bracket, it's included — and only the bracketed category
 *      comes back, not the un-bracketed one.
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
  const categories = await prisma.tournamentCategory.findMany({ where: { tournamentId }, select: { id: true } });
  const categoryIds = categories.map((c) => c.id);
  const registrations = await prisma.tournamentRegistration.findMany({
    where: { tournamentCategoryId: { in: categoryIds } },
    select: { id: true, teamId: true, team: { select: { player1Id: true, player2Id: true } } },
  });
  const registrationIds = registrations.map((r) => r.id);
  const teamIds = registrations.map((r) => r.teamId);
  const playerIds = registrations.flatMap((r) =>
    r.team.player2Id ? [r.team.player1Id, r.team.player2Id] : [r.team.player1Id],
  );
  const matches = await prisma.match.findMany({ where: { tournamentCategoryId: { in: categoryIds } }, select: { id: true } });
  const matchIds = matches.map((m) => m.id);
  await prisma.score.deleteMany({ where: { matchId: { in: matchIds } } });
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await prisma.sale.deleteMany({ where: { tournamentRegistrationId: { in: registrationIds } } });
  await prisma.tournamentRegistration.deleteMany({ where: { id: { in: registrationIds } } });
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
  const players = await prisma.player.findMany({ where: { id: { in: playerIds } }, select: { userId: true } });
  await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: players.map((p) => p.userId) } } });
  await prisma.tournamentCategory.deleteMany({ where: { tournamentId } });
  await prisma.tournament.deleteMany({ where: { id: tournamentId } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: ownerEmployee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-PUBTOURNEY-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const saleContext = { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id };
  const suffix = Date.now();

  const tournament = await tournamentService.createTournament(
    {
      name: `Public Gate Test Tournament ${suffix}`,
      startDate: new Date(2031, 11, 5),
      endDate: new Date(2031, 11, 6),
      collectsPaymentOnSite: true,
    },
    owner.id,
  );

  try {
    const bracketedCategory = await tournamentService.createCategory(
      tournament.id,
      { name: "Bracketed Category", format: "ROUND_ROBIN", division: "OPEN" },
      owner.id,
    );
    await tournamentService.createCategory(
      tournament.id,
      { name: "Unbracketed Category", format: "ROUND_ROBIN", division: "OPEN" },
      owner.id,
    );

    // 1. Still DRAFT, no bracket anywhere — excluded.
    const beforeAnything = await tournamentService.listPublicTournamentsWithBrackets();
    assert(
      !beforeAnything.some((t) => t.id === tournament.id),
      "expected a fresh DRAFT tournament with no bracket to be excluded",
    );

    await tournamentService.registerTeam(
      bracketedCategory.id,
      { player1Name: `Public Gate A ${suffix}`, player2Name: `Public Gate B ${suffix}`, paymentMethodId: cashMethod.id },
      owner.id,
      saleContext,
    );
    await tournamentService.registerTeam(
      bracketedCategory.id,
      { player1Name: `Public Gate C ${suffix}`, player2Name: `Public Gate D ${suffix}`, paymentMethodId: cashMethod.id },
      owner.id,
      saleContext,
    );
    await tournamentService.generateBracket(bracketedCategory.id, owner.id);

    // 2. A real bracket exists now, but the tournament is still DRAFT —
    // still excluded regardless of the category having matches.
    const stillDraft = await tournamentService.listPublicTournamentsWithBrackets();
    assert(
      !stillDraft.some((t) => t.id === tournament.id),
      "expected a DRAFT tournament to stay excluded even once a category has a real bracket",
    );
    console.log("PASS: a DRAFT tournament is excluded regardless of bracket state.");

    // 3. Advance past DRAFT — now it qualifies, and only the bracketed
    // category comes back (the unbracketed one is left out).
    await prisma.tournament.update({ where: { id: tournament.id }, data: { status: "IN_PROGRESS" } });
    const afterAdvance = await tournamentService.listPublicTournamentsWithBrackets();
    const found = afterAdvance.find((t) => t.id === tournament.id);
    assert(found !== undefined, "expected the tournament to qualify once advanced past DRAFT with a real bracket");
    assert(
      found!.categories.length === 1 && found!.categories[0].id === bracketedCategory.id,
      "expected only the bracketed category to come back, not the unbracketed one",
    );
    console.log(
      "PASS: an advanced tournament with a real bracket qualifies, and only the bracketed category is returned.",
    );

    // 4. CANCELLED is excluded too, same as DRAFT.
    await prisma.tournament.update({ where: { id: tournament.id }, data: { status: "CANCELLED" } });
    const afterCancel = await tournamentService.listPublicTournamentsWithBrackets();
    assert(
      !afterCancel.some((t) => t.id === tournament.id),
      "expected a CANCELLED tournament to be excluded even with a real bracket",
    );
    console.log("PASS: a CANCELLED tournament is excluded regardless of bracket state.");

    await cleanUp(tournament.id);
  } catch (error) {
    await cleanUp(tournament.id);
    throw error;
  }

  console.log(
    "\nPASS: listPublicTournamentsWithBrackets' bracketing gate proven against real rows.",
  );
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
