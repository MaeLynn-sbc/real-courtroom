/**
 * Tournament players vs. regulars (owner, 2026-09-17). The group is
 * derived from activity: tournament-only players sit in their own tab
 * and move to Regulars on their own once they do anything else here.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "../open-play/open-play-capacity.service";
import { playerService } from "./player.service";

const PREFIX = "Grouptest";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function cleanUp(date: Date | null): Promise<void> {
  if (date) {
    const session = await prisma.openPlayNightSession.findUnique({ where: { date } });
    if (session) {
      await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: session.id } });
      await prisma.openPlayNightSession.delete({ where: { id: session.id } });
    }
  }
  const users = await prisma.user.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  const players = await prisma.player.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { id: true } });
  const ids = players.map((p) => p.id);
  await prisma.team.deleteMany({ where: { OR: [{ player1Id: { in: ids } }, { player2Id: { in: ids } }] } });
  await prisma.player.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const role = await prisma.role.findFirstOrThrow({ where: { name: "MEMBER" } });
  const friday = (await openPlayCapacityService.getUpcomingNights(21)).find((n) => n.dayOfWeek === 5)?.date ?? null;
  assert(friday, "expected an upcoming Friday");
  await cleanUp(friday);

  const make = async (name: string) => {
    const user = await prisma.user.create({ data: { name: `${PREFIX} ${name}`, roleId: role.id } });
    return prisma.player.create({ data: { userId: user.id } });
  };

  try {
    const tourney = await make("Tourney");
    const both = await make("Both");
    const fresh = await make("Fresh");
    await prisma.team.create({ data: { player1Id: tourney.id } });
    await prisma.team.create({ data: { player1Id: fresh.id, player2Id: both.id } });

    // `both` also played open play.
    const session = await openPlayCapacityService.setSessionCapacityOverride(friday, 10, owner.id);
    await prisma.openPlayNightRegistration.create({
      data: { sessionId: session.id, date: friday, playerId: both.id, playerName: `${PREFIX} Both`, phone: "1", skillLevel: "NOVICE", status: "CONFIRMED", source: "WALK_IN" },
    });
    const untouched = await make("Handmade");

    const ids = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
    // Searched by this test's own prefix: the dev database can hold more
    // players than listPlayers' 1000-row cap, which would hide ours.
    const group = async (g: "tournament" | "regulars" | "all") => ids(await playerService.searchPlayers({ query: PREFIX }, g));
    const tournament = await group("tournament");
    const regulars = await group("regulars");
    const all = await group("all");

    assert(tournament.has(tourney.id) && tournament.has(fresh.id), "tournament-only players are in the Tournament group");
    assert(!regulars.has(tourney.id) && !regulars.has(fresh.id), "tournament-only players are not in Regulars");
    assert(regulars.has(both.id) && !tournament.has(both.id), "a tournament player who also played open play is a Regular");
    assert(regulars.has(untouched.id) && !tournament.has(untouched.id), "a hand-made profile with no activity is a Regular");
    assert([tourney, both, fresh, untouched].every((p) => all.has(p.id)), "All shows everyone");
    console.log("PASS: players split into Regulars and Tournament only by what they have done.");

    const searched = await playerService.searchPlayers({ query: PREFIX }, "tournament");
    assert(
      searched.length === 2 && searched.every((p) => p.id === tourney.id || p.id === fresh.id),
      "search respects the group",
    );
    const counts = await playerService.countPlayersByGroup();
    assert(counts.all === counts.regulars + counts.tournament, "the two groups add up to All");
    console.log("PASS: search and counts respect the groups.");

    // Showing up for open play moves a tournament player to Regulars.
    await prisma.openPlayNightRegistration.create({
      data: { sessionId: session.id, date: friday, playerId: tourney.id, playerName: `${PREFIX} Tourney`, phone: "1", skillLevel: "NOVICE", status: "CONFIRMED", source: "WALK_IN" },
    });
    assert((await group("regulars")).has(tourney.id), "a tournament player who comes back becomes a Regular");
    console.log("PASS: a returning tournament player moves to Regulars on their own.");
  } finally {
    await cleanUp(friday);
  }
  console.log("PASS: player groups proven.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
