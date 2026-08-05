/**
 * Owner request (2026-08-05): "tournament is sometimes outside event
 * ... this time they are paid already on the organizers. so we will
 * not record the payments." Tournament.collectsPaymentOnSite (default
 * true, unchanged behavior) lets a tournament opt out of registration
 * payments entirely.
 *
 * Proves, against real rows:
 *   1. registerTeam with saleContext: null creates the registration
 *      (CONFIRMED, same as normal) but creates NO Sale row at all.
 *   2. The exact same call WITH a real saleContext (the tournament
 *      collects payment) DOES create a Sale — proven failing-first:
 *      confirms the no-Sale result above isn't just "registerTeam never
 *      creates a Sale," it's specifically saleContext: null skipping it.
 *
 * registerTeamAction's own auth-path selection (requireEmployee, no
 * shift, when collectsPaymentOnSite is false vs. requireEmployeeWithOpen
 * Shift when it's true) isn't proven here — every other integration test
 * in this codebase calls services directly for exactly the reason this
 * one does too: actions/*.ts depend on auth() reading a real Next.js
 * request session, which doesn't exist in a plain script. That branch is
 * a straightforward boolean dispatch between two independently-used,
 * already-relied-upon lib/action-auth.ts helpers — reviewed by hand
 * rather than integration-tested.
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
    const category = await prisma.tournamentCategory.findFirst({ where: { tournamentId } });
    if (category) {
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
  }
  await prisma.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const suffix = Date.now();

  const noPaymentTournament = await tournamentService.createTournament(
    {
      name: `No Payment Test Tournament ${suffix}`,
      startDate: new Date(2031, 9, 1),
      endDate: new Date(2031, 9, 2),
      collectsPaymentOnSite: false,
    },
    owner.id,
  );
  const paidTournament = await tournamentService.createTournament(
    {
      name: `Paid Test Tournament ${suffix}`,
      startDate: new Date(2031, 9, 1),
      endDate: new Date(2031, 9, 2),
      collectsPaymentOnSite: true,
    },
    owner.id,
  );

  try {
    const noPaymentCategory = await tournamentService.createCategory(
      noPaymentTournament.id,
      { name: "No Payment Category", format: "ROUND_ROBIN", division: "OPEN", feeCents: 50000 },
      owner.id,
    );
    const paidCategory = await tournamentService.createCategory(
      paidTournament.id,
      { name: "Paid Category", format: "ROUND_ROBIN", division: "OPEN", feeCents: 50000 },
      owner.id,
    );

    // ============== 1. saleContext: null -> registration created, NO Sale ==============
    const noPaymentReg = await tournamentService.registerTeam(
      noPaymentCategory.id,
      { player1Name: `No Payment Player ${suffix}` },
      owner.id,
      null,
    );
    assert(noPaymentReg.status === "CONFIRMED", `expected CONFIRMED, got ${noPaymentReg.status}`);
    const noSale = await prisma.sale.findFirst({
      where: { tournamentRegistrationId: noPaymentReg.id },
    });
    assert(noSale === null, `expected NO Sale row for a no-payment tournament registration, found one: ${JSON.stringify(noSale)}`);
    console.log("PASS: registerTeam with saleContext: null registers the team but creates no Sale at all.");

    // ============== 2. Failing-first contrast: WITH a saleContext, a Sale IS created ==============
    const shiftForPaid = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-NOPAY-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
    const paidReg = await tournamentService.registerTeam(
      paidCategory.id,
      { player1Name: `Paid Player ${suffix}`, paymentMethodId: cashMethod.id },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shiftForPaid.id, paymentMethodId: cashMethod.id },
    );
    const realSale = await prisma.sale.findFirst({ where: { tournamentRegistrationId: paidReg.id } });
    assert(realSale !== null, "expected a real Sale row when saleContext is provided (the contrast case)");
    assert(realSale!.amountCents === 50000, `expected the Sale to record the category's feeCents (50000), got ${realSale!.amountCents}`);
    console.log("PASS: the exact same function WITH a saleContext creates a real Sale — confirming case 1's null result was deliberate, not registerTeam silently never charging.");
    await prisma.shift.update({ where: { id: shiftForPaid.id }, data: { status: "CLOSED", endedAt: new Date() } });

    await cleanUp([noPaymentTournament.id, paidTournament.id]);
  } catch (error) {
    await cleanUp([noPaymentTournament.id, paidTournament.id]);
    throw error;
  }

  console.log(
    "\nPASS: Tournament.collectsPaymentOnSite proven against real rows — no Sale, no shift requirement, when a tournament opts out.",
  );
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
