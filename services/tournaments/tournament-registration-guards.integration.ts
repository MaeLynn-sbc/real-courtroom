/**
 * Reported live: a player already registered on one team in a category
 * was still selectable in the Player and Partner dropdowns for a second
 * team — nothing stopped them from ending up double-registered. Also
 * added: an optional payment receipt upload on registration, same
 * private-upload mechanism as Expense.receiptStorageKey.
 *
 * Proves, against real rows:
 *   1. A player already on a CONFIRMED registration cannot be registered
 *      again as player1 of a new team.
 *   2. Nor can they be registered as someone else's partner (player2).
 *   3. Once their registration is withdrawn, the same player CAN be
 *      registered again — the guard only blocks an ACTIVE registration,
 *      not a withdrawn one.
 *   4. A receipt attached at registration is uploaded and its bytes are
 *      retrievable by the stored key, byte-for-byte.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { playerService } from "../player/player.service";
import { getUploadService } from "../upload/upload-service.factory";
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
        shiftNumber: `SHIFT-REGGUARD-${Date.now()}`,
        employeeId: ownerEmployee.id,
        status: "OPEN",
      },
    });
  }
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const saleContext = { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id };

  const playerIds: string[] = [];
  async function makePlayer(label: string): Promise<string> {
    const player = await playerService.createPlayer(
      {
        name: `RegGuard Test ${label}`,
        email: `regguard-${label.toLowerCase()}-${Date.now()}@example.test`,
      },
      owner.id,
    );
    playerIds.push(player.id);
    return player.id;
  }

  const tournament = await tournamentService.createTournament(
    {
      name: `RegGuard Test Tournament ${Date.now()}`,
      startDate: new Date(2031, 9, 1),
      endDate: new Date(2031, 9, 2),
    },
    owner.id,
  );

  try {
    const category = await tournamentService.createCategory(
      tournament.id,
      { name: "Test Category", format: "ROUND_ROBIN", division: "OPEN" },
      owner.id,
    );

    const playerA = await makePlayer("A");
    const playerB = await makePlayer("B");
    const playerC = await makePlayer("C");

    const regA = await tournamentService.registerTeam(
      category.id,
      { player1Id: playerA, paymentMethodId: cashMethod.id },
      owner.id,
      saleContext,
    );
    assert(regA.status === "CONFIRMED", `expected playerA's team to be CONFIRMED, got ${regA.status}`);

    // 1. playerA is already active — cannot register again as player1.
    let rejectedAsPlayer1 = false;
    try {
      await tournamentService.registerTeam(
        category.id,
        { player1Id: playerA, paymentMethodId: cashMethod.id },
        owner.id,
        saleContext,
      );
    } catch (error) {
      rejectedAsPlayer1 = error instanceof Error && error.message.includes("already registered");
    }
    assert(rejectedAsPlayer1, "expected registering playerA a second time as player1 to be rejected");
    console.log("PASS: a player already on an active registration cannot be registered again as player1.");

    // 2. playerA cannot be smuggled in as someone else's partner either.
    let rejectedAsPartner = false;
    try {
      await tournamentService.registerTeam(
        category.id,
        { player1Id: playerB, player2Id: playerA, paymentMethodId: cashMethod.id },
        owner.id,
        saleContext,
      );
    } catch (error) {
      rejectedAsPartner = error instanceof Error && error.message.includes("already registered");
    }
    assert(rejectedAsPartner, "expected registering playerA as a partner while already active to be rejected");
    console.log("PASS: a player already on an active registration cannot be registered as a partner either.");

    // 3. Withdraw playerA's registration — they should be free again.
    await tournamentService.cancelRegistration(regA.id, owner.id);
    const regAfterWithdraw = await tournamentService.registerTeam(
      category.id,
      { player1Id: playerA, player2Id: playerC, paymentMethodId: cashMethod.id },
      owner.id,
      saleContext,
    );
    assert(
      regAfterWithdraw.status === "CONFIRMED",
      `expected playerA to be re-registerable once withdrawn, got ${regAfterWithdraw.status}`,
    );
    console.log("PASS: a withdrawn registration frees its players for a new registration.");

    // 4. Receipt upload — bytes round-trip through the private storage key.
    const receiptBytes = Buffer.from(`test receipt ${Date.now()}`);
    const playerD = await makePlayer("D");
    const regWithReceipt = await tournamentService.registerTeam(
      category.id,
      { player1Id: playerD, paymentMethodId: cashMethod.id },
      owner.id,
      saleContext,
      { fileName: "receipt.png", contentType: "image/png", data: receiptBytes },
    );
    assert(
      typeof regWithReceipt.receiptStorageKey === "string" && regWithReceipt.receiptStorageKey.length > 0,
      "expected a receiptStorageKey to be stored when a receipt is attached",
    );
    const storedBytes = await getUploadService().get(regWithReceipt.receiptStorageKey as string);
    assert(storedBytes !== null, "expected the uploaded receipt to be retrievable by its stored key");
    assert(
      storedBytes!.equals(receiptBytes),
      "expected the retrieved receipt bytes to exactly match what was uploaded",
    );
    console.log("PASS: an attached receipt is uploaded and retrievable byte-for-byte by its stored key.");

    await getUploadService()
      .delete(regWithReceipt.receiptStorageKey as string)
      .catch(() => undefined);

    await cleanUp(tournament.id, playerIds);
  } catch (error) {
    await cleanUp(tournament.id, playerIds);
    throw error;
  }

  console.log(
    "\nPASS: tournament registration double-registration guard and receipt upload proven against real rows.",
  );
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
