/**
 * Duplicate walk-in players merge (scripts/merge-duplicate-players.ts).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "../open-play/open-play-capacity.service";
import { loadActivePlayers, mergeGroup, planMerges } from "./player-merge";

const SAME = "Mergetest Samename";
const CONFLICT = "Mergetest Twophones";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function createPlayer(
  name: string,
  phone: string | null,
  level: "NOVICE" | "ADVANCED" | null,
  roleId: string,
  email?: string,
) {
  const user = await prisma.user.create({ data: { name, roleId, email } });
  return prisma.player.create({ data: { userId: user.id, phone, openPlaySkillLevel: level } });
}

async function cleanUp(date: Date): Promise<void> {
  const session = await prisma.openPlayNightSession.findUnique({ where: { date } });
  if (session) {
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: session.id } });
    await prisma.openPlayNightSession.delete({ where: { id: session.id } });
  }
  const users = await prisma.user.findMany({
    where: { OR: [{ name: { startsWith: "mergetest", mode: "insensitive" } }] },
    select: { id: true },
  });
  const players = await prisma.player.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { action: "player.merged", entityId: { in: players.map((p) => p.id) } } });
  await prisma.player.deleteMany({ where: { id: { in: players.map((p) => p.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const role = await prisma.role.findFirstOrThrow({ where: { name: "MEMBER" } });
  const friday = (await openPlayCapacityService.getUpcomingNights(21)).find((n) => n.dayOfWeek === 5)?.date;
  assert(friday, "expected an upcoming Friday");
  await cleanUp(friday);

  try {
    const session = await openPlayCapacityService.setSessionCapacityOverride(friday, 10, owner.id);

    // Three rows for one person: junk phones, one real phone on the newest.
    const oldest = await createPlayer(SAME.toLowerCase(), "1", null, role.id);
    // A contact email from the website form is not a login: it must not
    // stop the merge.
    const middle = await createPlayer(SAME, ".", "NOVICE", role.id, `mergetest-${Date.now()}@example.com`);
    const newest = await createPlayer(SAME.toUpperCase(), "0917 123 4567", null, role.id);
    // Two rows with DIFFERENT real phones: must be left alone.
    await createPlayer(CONFLICT, "09170000001", null, role.id);
    await createPlayer(CONFLICT, "09170000002", null, role.id);

    for (const [player, name] of [[middle, "a"], [newest, "b"]] as const) {
      await prisma.openPlayNightRegistration.create({
        data: { sessionId: session.id, date: friday, playerId: player.id, playerName: `${SAME} ${name}`, phone: "1", skillLevel: "NOVICE", status: "CONFIRMED", source: "WALK_IN" },
      });
    }

    const plan = planMerges(await loadActivePlayers());
    const group = plan.toMerge.find((g) => g.keeper.user.name?.toLowerCase() === SAME.toLowerCase());
    assert(group, "the same-name group is planned for merging");
    assert(group.keeper.id === oldest.id, "the oldest row is the keeper");
    assert(group.dups.length === 2, "the other two rows are the duplicates");
    assert(
      plan.phoneConflicts.some((c) => c.name === CONFLICT),
      "the group with two different real phones is left for the owner",
    );
    assert(
      !plan.toMerge.some((g) => g.keeper.user.name === CONFLICT),
      "the phone-conflict group is never merged",
    );
    console.log("PASS: planning keeps the oldest, and skips a group with two different real phones.");

    const result = await prisma.$transaction((tx) => mergeGroup(tx, group.keeper, group.dups, owner.id));

    const regs = await prisma.openPlayNightRegistration.findMany({ where: { sessionId: session.id } });
    assert(regs.length === 2 && regs.every((r) => r.playerId === oldest.id), "both registrations now belong to the keeper");
    const keeper = await prisma.player.findUniqueOrThrow({ where: { id: oldest.id }, include: { user: true } });
    assert(keeper.deletedAt === null, "the keeper stays active");
    assert(keeper.phone === "0917 123 4567", `the keeper inherits the real phone, got ${keeper.phone}`);
    assert(keeper.openPlaySkillLevel === "NOVICE", `the keeper inherits the open play level, got ${keeper.openPlaySkillLevel}`);
    assert(keeper.user.name === SAME, `the keeper takes the best-cased name, got ${keeper.user.name}`);
    assert(result.moved.openPlayNightRegistrations === 2, "the result reports what moved");
    const dups = await prisma.player.findMany({ where: { id: { in: [middle.id, newest.id] } } });
    assert(dups.every((d) => d.deletedAt !== null), "the duplicates are soft-deleted, not destroyed");
    const audit = await prisma.auditLog.findFirst({ where: { action: "player.merged", entityId: oldest.id } });
    assert(audit, "the merge is audited");
    console.log("PASS: merging moves history, soft-deletes the extras, and carries over phone, level and name.");

    const again = planMerges(await loadActivePlayers());
    assert(
      !again.toMerge.some((g) => g.keeper.user.name?.toLowerCase() === SAME.toLowerCase()),
      "a second run finds nothing left in that group",
    );
    console.log("PASS: the merge is idempotent.");
  } finally {
    await cleanUp(friday);
  }
  console.log("PASS: duplicate player merge proven.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
