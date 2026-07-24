/**
 * Hardening phase, fix 6/6 (BUILD-SPEC.md §0 process rule): releaseRegistration
 * locks the SESSION row, but releasedHadSeat/releasedWaitlistPos — used to
 * decide whether to promote the waitlist — were read BEFORE that lock and
 * never re-validated after acquiring it. Two concurrent releases of the SAME
 * registration can both compute "this freed a seat" from the same stale
 * pre-lock snapshot and both promote — over-promoting one freed seat into
 * two newly-seated players.
 *
 * Fixture: a capacity-1 Fri/Sat session — one seated player (A), two
 * waitlisted behind them (B, C). Fires two concurrent releases of A (the
 * seated player). The corruption is BOTH B and C ending up seated
 * (waitlistPos null) for the one seat A actually freed — capacity 1,
 * seated count 2.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";

const RELEASE_RACE_DATE = new Date(2031, 1, 21); // Friday, distinct fixture

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const session = await prisma.openPlayNightSession.findUnique({ where: { date: RELEASE_RACE_DATE } });
  if (!session) return;
  const registrations = await prisma.openPlayNightRegistration.findMany({ where: { sessionId: session.id }, select: { id: true } });
  const ids = registrations.map((r) => r.id);
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
  const tabIds = tabs.map((t) => t.id);
  await prisma.sale.deleteMany({ where: { playerTabId: { in: tabIds } } });
  await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.queueEntry.deleteMany({ where: { sessionId: session.id } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: session.id } });
  await prisma.openPlayNightSession.delete({ where: { id: session.id } });
}

async function main(): Promise<void> {
  await cleanUp();
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  const session = await openPlayCapacityService.setSessionCapacityOverride(RELEASE_RACE_DATE, 1, owner.id);

  const playerA = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Release Race Seated", phone: "09950001", skillLevel: "INTERMEDIATE" },
    owner.id,
  );
  const playerB = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Release Race Waitlist B", phone: "09950002", skillLevel: "INTERMEDIATE" },
    owner.id,
  );
  const playerC = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Release Race Waitlist C", phone: "09950003", skillLevel: "INTERMEDIATE" },
    owner.id,
  );
  assert(playerA.waitlistPos === null, "player A should be seated (capacity 1, first in)");
  assert(playerB.waitlistPos === 1, "player B should be waitlisted at position 1");
  assert(playerC.waitlistPos === 2, "player C should be waitlisted at position 2");

  console.log("Firing two concurrent releases of the same seated registration...");
  await Promise.allSettled([
    openPlayRegistrationService.cancelRegistration(playerA.id, owner.id),
    openPlayRegistrationService.cancelRegistration(playerA.id, owner.id),
  ]);

  const finalRegistrations = await prisma.openPlayNightRegistration.findMany({ where: { sessionId: session.id } });
  const seated = finalRegistrations.filter((r) => r.status === "CONFIRMED" && r.waitlistPos === null);
  console.log(
    `Seated after release: ${seated.length} (capacity ${session.capacity}) — ${seated.map((r) => r.playerName).join(", ")}`,
  );

  assert(
    seated.length <= session.capacity,
    `session capacity is ${session.capacity} but ${seated.length} registrations ended up seated — one freed seat was promoted twice`,
  );

  await cleanUp();
  console.log("PASS — releasing one seat never promotes more than one waitlisted registration.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUp().catch(() => undefined);
  process.exit(1);
});
