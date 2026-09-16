/**
 * Walk-in check-in matches an existing player by NAME when the phone
 * typed at the desk is not a real number (owner, 2026-09-17). Staff type
 * "1" or "." for the phone, and every visit used to create a fresh
 * player — 139 duplicate groups by mid-September.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";

const NAME = "Walkin Namematch Test";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function cleanUp(dates: Date[]): Promise<void> {
  for (const date of dates) {
    const existing = await prisma.openPlayNightSession.findUnique({ where: { date } });
    if (existing) {
      await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: existing.id } });
      await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
      await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
    }
  }
  const users = await prisma.user.findMany({ where: { name: { equals: NAME, mode: "insensitive" } }, select: { id: true } });
  await prisma.player.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const upcoming = await openPlayCapacityService.getUpcomingNights(21);
  const friday = upcoming.find((n) => n.dayOfWeek === 5)?.date;
  const saturday = upcoming.find((n) => n.dayOfWeek === 6)?.date;
  assert(friday && saturday, "expected an upcoming Friday and Saturday");
  await cleanUp([friday, saturday]);

  try {
    const fri = await openPlayCapacityService.setSessionCapacityOverride(friday, 4, owner.id);
    const sat = await openPlayCapacityService.setSessionCapacityOverride(saturday, 4, owner.id);

    // 1. Junk phone, same name, two nights: ONE player.
    const first = await openPlayRegistrationService.registerWalkIn(fri.id, { playerName: NAME, phone: "1", skillLevel: "NOVICE" }, owner.id);
    const second = await openPlayRegistrationService.registerWalkIn(sat.id, { playerName: NAME.toUpperCase(), phone: ".", skillLevel: "NOVICE" }, owner.id);
    assert(first.playerId === second.playerId, "a junk-phone walk-in with the same name reuses the player");
    console.log("PASS: same name with a junk phone reuses the existing player (case-insensitive).");

    // 2. A real phone typed later is saved onto that player.
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: sat.id } });
    const third = await openPlayRegistrationService.registerWalkIn(sat.id, { playerName: NAME, phone: "09171112222", skillLevel: "NOVICE" }, owner.id);
    assert(third.playerId === first.playerId, "a real phone on a name match still reuses the player");
    const saved = await prisma.player.findUniqueOrThrow({ where: { id: first.playerId } });
    assert(saved.phone === "09171112222", `the real phone is saved onto the player, got ${saved.phone}`);
    console.log("PASS: a real phone typed later is saved onto the matched player.");

    // 3. Same name but a DIFFERENT real phone is a different person.
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: sat.id } });
    const fourth = await openPlayRegistrationService.registerWalkIn(sat.id, { playerName: NAME, phone: "09179998888", skillLevel: "NOVICE" }, owner.id);
    assert(fourth.playerId !== first.playerId, "a different real phone creates a new player");
    console.log("PASS: same name with a different real phone is treated as a different person.");

    // 4. The phone match still wins over the name match.
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: fri.id } });
    const fifth = await openPlayRegistrationService.registerWalkIn(fri.id, { playerName: "Someone Else", phone: "0917 999 8888", skillLevel: "NOVICE" }, owner.id);
    assert(fifth.playerId === fourth.playerId, "a matching real phone reuses the player regardless of the name typed");
    console.log("PASS: a real phone match still comes first.");
  } finally {
    await cleanUp([friday, saturday]);
  }
  console.log("PASS: walk-in name matching proven.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
