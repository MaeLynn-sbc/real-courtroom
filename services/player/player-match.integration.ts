/**
 * One same-person rule for every flow that creates players (owner,
 * 2026-09-17): walk-in check-in, the Players tab's New player form, and
 * tournament registration all reuse an existing player when it is the
 * same person. See services/player/player-match.ts.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { tournamentService } from "../tournaments/tournament.service";
import { findMatchingPlayer } from "./player-match";
import { playerService } from "./player.service";

const PREFIX = "Matchrule";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function seed(name: string, phone: string | null, roleId: string, email?: string) {
  const user = await prisma.user.create({ data: { name, roleId, email } });
  return prisma.player.create({ data: { userId: user.id, phone } });
}

async function cleanUp(tournamentId: string | null): Promise<void> {
  if (tournamentId) {
    const categories = await prisma.tournamentCategory.findMany({ where: { tournamentId }, select: { id: true } });
    const regs = await prisma.tournamentRegistration.findMany({
      where: { tournamentCategoryId: { in: categories.map((c) => c.id) } },
      select: { id: true, teamId: true },
    });
    await prisma.sale.deleteMany({ where: { tournamentRegistrationId: { in: regs.map((r) => r.id) } } });
    await prisma.tournamentRegistration.deleteMany({ where: { id: { in: regs.map((r) => r.id) } } });
    await prisma.team.deleteMany({ where: { id: { in: regs.map((r) => r.teamId) } } });
    await prisma.tournamentCategory.deleteMany({ where: { tournamentId } });
    await prisma.tournament.deleteMany({ where: { id: tournamentId } });
  }
  const users = await prisma.user.findMany({ where: { name: { startsWith: PREFIX, mode: "insensitive" } }, select: { id: true } });
  const players = await prisma.player.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: players.map((p) => p.id) } } });
  await prisma.team.deleteMany({ where: { OR: [{ player1Id: { in: players.map((p) => p.id) } }, { player2Id: { in: players.map((p) => p.id) } }] } });
  await prisma.player.deleteMany({ where: { id: { in: players.map((p) => p.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const role = await prisma.role.findFirstOrThrow({ where: { name: "MEMBER" } });
  const stamp = Date.now();
  await cleanUp(null);
  let tournamentId: string | null = null;

  try {
    const junk = await seed(`${PREFIX} Junkphone`, "1", role.id);
    const real = await seed(`${PREFIX} Realphone`, "0917 555 0001", role.id);
    await seed(`${PREFIX} Twins`, "09175550002", role.id);
    await seed(`${PREFIX} Twins`, "09175550003", role.id);
    const mailed = await seed(`${PREFIX} Mailed`, null, role.id, `matchrule-${stamp}@example.com`);

    // ---------- the rule itself ----------
    const q = (name: string, phone?: string, email?: string) =>
      prisma.$transaction((tx) => findMatchingPlayer(tx, { name, phone, email }));

    assert((await q("someone else", "+63 917 555 0001"))?.playerId === real.id, "a real phone matches regardless of name");
    assert((await q("x", undefined, `MATCHRULE-${stamp}@example.com`))?.playerId === mailed.id, "an email matches, case-insensitive");
    assert((await q(`  ${PREFIX.toUpperCase()}   JUNKPHONE `, "."))?.playerId === junk.id, "the same name matches, ignoring case and spacing");
    assert((await q(`${PREFIX} Junkphone`, "09175559999"))?.playerId === junk.id, "a new real phone still matches a name with no real phone");
    assert((await q(`${PREFIX} Realphone`, "1"))?.playerId === real.id, "a junk phone matches a same-name player whose real phone is the only one");
    assert((await q(`${PREFIX} Realphone`, "09175559999")) === null, "a different real phone is a different person");
    assert((await q(`${PREFIX} Twins`)) === null, "two same-name players with different real phones are ambiguous: no match");
    assert((await q(`${PREFIX} Mailed`, undefined, "other@example.com")) === null, "a different email is a different person");
    assert((await q(`${PREFIX} Nobody`)) === null, "an unknown name matches nobody");
    console.log("PASS: the same-person rule matches by phone, then email, then name, and refuses the ambiguous cases.");

    // ---------- New player form ----------
    const before = await prisma.player.count();
    const formResult = await playerService.createPlayer(
      { name: `${PREFIX} junkphone`, email: `matchrule-new-${stamp}@example.com`, phone: "0917 555 0004", openPlaySkillLevel: "ADVANCED" },
      owner.id,
    );
    assert(formResult.matchedExisting, "the form reports it matched an existing player");
    assert(formResult.player.id === junk.id, "the form returns the existing player");
    assert((await prisma.player.count()) === before, "no new player row was created");
    const filled = await prisma.player.findUniqueOrThrow({ where: { id: junk.id }, include: { user: true } });
    assert(filled.phone === "0917 555 0004", "the real phone from the form fills the blank one");
    assert(filled.openPlaySkillLevel === "ADVANCED", "the open play level from the form fills the blank one");
    assert(filled.user.email === `matchrule-new-${stamp}@example.com`, "the email from the form is attached");
    const fresh = await playerService.createPlayer({ name: `${PREFIX} Brandnew`, email: `matchrule-bn-${stamp}@example.com` }, owner.id);
    assert(!fresh.matchedExisting, "a genuinely new person is still created");
    console.log("PASS: the New player form reuses the existing player and fills in what it was missing.");

    // ---------- tournament registration ----------
    const tournament = await tournamentService.createTournament(
      { name: `${PREFIX} Cup ${stamp}`, startDate: new Date(2031, 9, 12), endDate: new Date(2031, 9, 13), collectsPaymentOnSite: false },
      owner.id,
    );
    tournamentId = tournament.id;
    const category = await tournamentService.createCategory(tournament.id, { name: "Open", format: "ROUND_ROBIN", division: "OPEN" }, owner.id);
    const reg = await tournamentService.registerTeam(
      category.id,
      { player1Name: `${PREFIX} REALPHONE`, player2Name: `${PREFIX} Newpartner` },
      owner.id,
      null,
    );
    const team = await prisma.team.findUniqueOrThrow({ where: { id: reg.teamId } });
    assert(team.player1Id === real.id, "a typed tournament name resolves to the existing player");
    assert(team.player2Id && team.player2Id !== real.id, "an unknown partner is created as a new player");
    const self = await tournamentService.registerTeam(
      category.id,
      { player1Name: `${PREFIX} Solo ${stamp}`, player2Name: `${PREFIX} Solo ${stamp}` },
      owner.id,
      null,
    );
    const selfTeam = await prisma.team.findUniqueOrThrow({ where: { id: self.teamId } });
    assert(selfTeam.player1Id !== selfTeam.player2Id, "partners are never resolved to the same player");
    console.log("PASS: tournament registration reuses existing players and keeps partners distinct.");
  } finally {
    await cleanUp(tournamentId);
  }
  console.log("PASS: one same-person rule across all player-creating flows.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
