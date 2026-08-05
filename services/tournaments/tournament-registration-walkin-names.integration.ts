/**
 * Reported live: the "Register a team" panel required picking from
 * existing Player records — but tournament entrants are frequently
 * walk-ins with no Player record at all. Replaced with two plain typed
 * name fields (player1Name always, player2Name optional — blank means
 * singles); registerTeam now creates a minimal Player (+ User) for each
 * typed name on the spot. Also carries an optional payment receipt
 * upload, same private-upload mechanism as Expense.receiptStorageKey.
 *
 * Proves, against real rows:
 *   1. A doubles registration (both names given) creates two distinct,
 *      real Player rows and links them as Team.player1Id/player2Id.
 *   2. A singles registration (player2Name omitted) creates only one
 *      Player and leaves Team.player2Id null.
 *   3. Typing the exact same name twice (two separate registrations)
 *      creates two DIFFERENT Player rows — no silent dedup by name, the
 *      accepted tradeoff for typed walk-in entries.
 *   4. A receipt attached at registration is uploaded and its bytes are
 *      retrievable by the stored key, byte-for-byte.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { getUploadService } from "../upload/upload-service.factory";
import { tournamentService } from "./tournament.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(tournamentId: string): Promise<void> {
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
  await prisma.tournament.deleteMany({ where: { id: tournamentId } });
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
        shiftNumber: `SHIFT-WALKIN-${Date.now()}`,
        employeeId: ownerEmployee.id,
        status: "OPEN",
      },
    });
  }
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const saleContext = { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id };
  const suffix = Date.now();

  const tournament = await tournamentService.createTournament(
    {
      name: `WalkIn Test Tournament ${suffix}`,
      startDate: new Date(2031, 10, 1),
      endDate: new Date(2031, 10, 2),
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

    // 1. Doubles — both names create distinct real Player rows.
    const doublesReg = await tournamentService.registerTeam(
      category.id,
      { player1Name: `WalkIn A ${suffix}`, player2Name: `WalkIn B ${suffix}`, paymentMethodId: cashMethod.id },
      owner.id,
      saleContext,
    );
    const doublesTeam = await prisma.team.findUniqueOrThrow({
      where: { id: (await prisma.tournamentRegistration.findUniqueOrThrow({ where: { id: doublesReg.id } })).teamId },
      include: { player1: { include: { user: true } }, player2: { include: { user: true } } },
    });
    assert(doublesTeam.player1.user.name === `WalkIn A ${suffix}`, "expected player1's User.name to match the typed name");
    assert(doublesTeam.player2 !== null, "expected a doubles registration to create a real player2");
    assert(
      doublesTeam.player2!.user.name === `WalkIn B ${suffix}`,
      "expected player2's User.name to match the typed name",
    );
    assert(doublesTeam.player1Id !== doublesTeam.player2Id, "expected two distinct Player rows for a doubles team");
    console.log("PASS: a doubles registration creates two distinct real Player rows from the typed names.");

    // 2. Singles — player2Name omitted, Team.player2Id stays null.
    const singlesReg = await tournamentService.registerTeam(
      category.id,
      { player1Name: `WalkIn Solo ${suffix}`, paymentMethodId: cashMethod.id },
      owner.id,
      saleContext,
    );
    const singlesTeam = await prisma.team.findUniqueOrThrow({
      where: { id: (await prisma.tournamentRegistration.findUniqueOrThrow({ where: { id: singlesReg.id } })).teamId },
    });
    assert(singlesTeam.player2Id === null, "expected a singles registration (blank player 2) to leave player2Id null");
    console.log("PASS: leaving player 2 blank registers a singles team with no partner.");

    // 3. Same name typed twice — no silent dedup, two different Players.
    const repeatName = `WalkIn Repeat ${suffix}`;
    const repeatReg1 = await tournamentService.registerTeam(
      category.id,
      { player1Name: repeatName, paymentMethodId: cashMethod.id },
      owner.id,
      saleContext,
    );
    const repeatReg2 = await tournamentService.registerTeam(
      category.id,
      { player1Name: repeatName, paymentMethodId: cashMethod.id },
      owner.id,
      saleContext,
    );
    const repeatTeam1 = await prisma.team.findUniqueOrThrow({
      where: { id: (await prisma.tournamentRegistration.findUniqueOrThrow({ where: { id: repeatReg1.id } })).teamId },
    });
    const repeatTeam2 = await prisma.team.findUniqueOrThrow({
      where: { id: (await prisma.tournamentRegistration.findUniqueOrThrow({ where: { id: repeatReg2.id } })).teamId },
    });
    assert(
      repeatTeam1.player1Id !== repeatTeam2.player1Id,
      "expected typing the exact same name twice to create two different Player rows, not reuse one",
    );
    console.log("PASS: typing the same name twice creates two separate Player rows — no silent name matching.");

    // 4. Receipt upload — bytes round-trip through the private storage key.
    const receiptBytes = Buffer.from(`test receipt ${suffix}`);
    const regWithReceipt = await tournamentService.registerTeam(
      category.id,
      { player1Name: `WalkIn Receipt ${suffix}`, paymentMethodId: cashMethod.id },
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

    await cleanUp(tournament.id);
  } catch (error) {
    await cleanUp(tournament.id);
    throw error;
  }

  console.log(
    "\nPASS: typed walk-in name registration (2 slots, auto-created Players, receipt upload) proven against real rows.",
  );
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
