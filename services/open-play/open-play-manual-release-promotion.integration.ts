/**
 * Item 4 (Fri/Sat waitlist rework): the new "Release seat" button on
 * Expected rows calls markNoShowAction -> markNoShow ->
 * releaseRegistration — the SAME path reconcileNoShows always used, just
 * staff-triggered instead of automatic. This proves that manually
 * invoking markNoShow on a not-yet-arrived registration promotes the
 * walk-in waiting roster's head exactly as it always has: the promoted
 * player is seated (waitlistPos null) but NOT charged here (they pay at
 * the desk when promotion is actually built, item 2) — this test only
 * proves the SEAT PROMOTION mechanics survive being triggered manually.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayRegistrationService } from "./open-play-registration.service";

const TEST_SESSION_DATE = new Date(2031, 0, 24); // Friday, Jan 24 2031 — far enough out not to collide with real usage

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date: TEST_SESSION_DATE } });
  if (existing) {
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
  }
}

async function main(): Promise<void> {
  await cleanUp();

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const session = await prisma.openPlayNightSession.create({
    data: {
      date: TEST_SESSION_DATE,
      startAt: new Date(2031, 0, 24, 18, 0),
      endAt: new Date(2031, 0, 24, 23, 0),
      capacity: 1,
    },
  });

  const seated = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Manual Release Seated", phone: "09170000301", skillLevel: "INTERMEDIATE" },
    owner.id,
  );
  assert(seated.waitlistPos === null, "expected the first walk-in to take the only seat");

  const waitlisted = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Manual Release Waiting", phone: "09170000302", skillLevel: "INTERMEDIATE" },
    owner.id,
  );
  assert(waitlisted.waitlistPos === 1, `expected the second walk-in on the waiting roster, got waitlistPos=${waitlisted.waitlistPos}`);

  // The exact call the new "Release seat" button makes: markNoShow on
  // the not-yet-arrived seated player, manually, not via reconcileNoShows.
  await openPlayRegistrationService.markNoShow(seated.id, owner.id);

  const releasedRow = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: seated.id } });
  console.log(`Released registration status: ${releasedRow.status}`);
  assert(releasedRow.status === "NO_SHOW", `expected NO_SHOW, got ${releasedRow.status}`);

  const promotedRow = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: waitlisted.id } });
  console.log(`Waitlisted player's waitlistPos after manual release: ${promotedRow.waitlistPos}`);
  assert(promotedRow.waitlistPos === null, "expected the waitlisted player to be promoted (waitlistPos cleared) by the manual release");

  await cleanUp();
  console.log("PASS: manually releasing a not-yet-arrived seat (the new Release seat button's path) promotes the walk-in waiting roster head exactly as an automatic release always did.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await cleanUp().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
