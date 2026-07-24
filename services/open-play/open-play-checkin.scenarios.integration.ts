/**
 * BUILD-SPEC.md §6's three required correctness tests, run against real
 * Postgres with real transactions:
 *
 *   1. "register at 3PM, walk-in at 7PM, check the 3PM one in at 8PM —
 *      walk-in is ahead." Queue position derives from checkedInAt, never
 *      registeredAt.
 *   2. "Double-tap yields one entry." Check-in is idempotent.
 *   3. "A party of 3 with 2 arrived does not enter the queue." Party
 *      join is gated on every member's arrival.
 *
 * Run via `npm run test:integration` (see run-integration-tests.ts).
 * Uses weeknight registration throughout (no session/capacity needed) —
 * the queue-join logic being tested is keyed by `date`, identical for
 * weeknight and Fri/Sat.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";

const TEST_DATE = new Date(2031, 0, 6); // Monday, Jan 6 2031 — distinct from the concurrency test's Friday fixture

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const registrations = await prisma.openPlayNightRegistration.findMany({
    where: { date: TEST_DATE },
    select: { id: true },
  });
  const ids = registrations.map((r) => r.id);
  // Phase 7: checkIn now also opens a PlayerTab (BUILD-SPEC.md §6/§9) —
  // must be cleared before the registration it references.
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
  const tabIds = tabs.map((t) => t.id);
  await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.queueEntry.deleteMany({ where: { registrationId: { in: ids } } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { date: TEST_DATE } });
}

async function testQueueOrderByCheckInNotRegistration(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  // "Register at 3PM" — registered first.
  const early = await openPlayRegistrationService.registerWeeknightWalkIn(
    TEST_DATE,
    { playerName: "Registered Early", phone: "090001", skillLevel: "INTERMEDIATE" },
    owner.id,
  );
  // "Walk-in at 7PM" — registered second, but about to check in FIRST.
  const walkIn = await openPlayRegistrationService.registerWeeknightWalkIn(
    TEST_DATE,
    { playerName: "Walk-in Later", phone: "090002", skillLevel: "INTERMEDIATE" },
    owner.id,
  );

  // "Check the 3PM one in at 8PM" — the walk-in checks in first, then the
  // early registrant checks in after.
  await openPlayCheckinService.checkIn(walkIn.id, owner.id);
  await new Promise((resolve) => setTimeout(resolve, 10)); // guarantee a distinct, later joinedQueueAt
  await openPlayCheckinService.checkIn(early.id, owner.id);

  const walkInEntry = await prisma.queueEntry.findUniqueOrThrow({ where: { registrationId: walkIn.id } });
  const earlyEntry = await prisma.queueEntry.findUniqueOrThrow({ where: { registrationId: early.id } });

  assert(
    walkInEntry.joinedQueueAt.getTime() < earlyEntry.joinedQueueAt.getTime(),
    `expected the walk-in (checked in first) to have an earlier joinedQueueAt than the early registrant — got walkIn=${walkInEntry.joinedQueueAt.toISOString()}, early=${earlyEntry.joinedQueueAt.toISOString()}`,
  );
  console.log("PASS — queue order derives from check-in time, not registration time (walk-in is ahead).");
}

async function testDoubleTapIsIdempotent(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    TEST_DATE,
    { playerName: "Double Tapper", phone: "090003", skillLevel: "BEGINNER" },
    owner.id,
  );

  const first = await openPlayCheckinService.checkIn(registration.id, owner.id);
  const second = await openPlayCheckinService.checkIn(registration.id, owner.id);

  assert(first.alreadyCheckedIn === false, "expected the first check-in to not be a no-op");
  assert(second.alreadyCheckedIn === true, "expected the second (double-tap) check-in to be a no-op");

  const entryCount = await prisma.queueEntry.count({ where: { registrationId: registration.id } });
  assert(entryCount === 1, `expected exactly one QueueEntry after a double-tap, got ${entryCount}`);
  console.log("PASS — double-tapping check-in creates exactly one queue entry.");
}

async function testPartialPartyDoesNotEnterQueue(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const partyId = `test-party-${Date.now()}`;

  const [p1, p2, p3] = await Promise.all([
    openPlayRegistrationService.registerWeeknightWalkIn(
      TEST_DATE,
      { playerName: "Party One", phone: "090004", skillLevel: "NOVICE", partyId },
      owner.id,
    ),
    openPlayRegistrationService.registerWeeknightWalkIn(
      TEST_DATE,
      { playerName: "Party Two", phone: "090005", skillLevel: "NOVICE", partyId },
      owner.id,
    ),
    openPlayRegistrationService.registerWeeknightWalkIn(
      TEST_DATE,
      { playerName: "Party Three", phone: "090006", skillLevel: "NOVICE", partyId },
      owner.id,
    ),
  ]);

  await openPlayCheckinService.checkIn(p1.id, owner.id);
  await openPlayCheckinService.checkIn(p2.id, owner.id);

  const queueCountWithTwoArrived = await prisma.queueEntry.count({ where: { partyId } });
  assert(
    queueCountWithTwoArrived === 0,
    `expected 0 queue entries with 2 of 3 party members arrived, got ${queueCountWithTwoArrived}`,
  );

  await openPlayCheckinService.checkIn(p3.id, owner.id);

  const queueCountAllArrived = await prisma.queueEntry.count({ where: { partyId } });
  assert(
    queueCountAllArrived === 3,
    `expected all 3 party members to enter the queue together once everyone arrived, got ${queueCountAllArrived}`,
  );

  const entries = await prisma.queueEntry.findMany({ where: { partyId } });
  const joinTimes = new Set(entries.map((entry) => entry.joinedQueueAt.getTime()));
  assert(joinTimes.size === 1, "expected every party member's joinedQueueAt to be identical (the last member's check-in time)");
  console.log("PASS — a party enters the queue together only once every member has checked in.");
}

async function main(): Promise<void> {
  await cleanUp();
  try {
    await testQueueOrderByCheckInNotRegistration();
    await testDoubleTapIsIdempotent();
    await testPartialPartyDoesNotEnterQueue();
  } finally {
    await cleanUp();
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await cleanUp().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
