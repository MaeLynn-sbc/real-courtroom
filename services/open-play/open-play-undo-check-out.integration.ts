/**
 * Undo check-out (owner request, 2026-10-03: a check-out tapped by
 * mistake had no way back). Proves, against real rows:
 *   - Fri/Sat: a check-out that let the waitlist head take the seat
 *     can't be undone into an overbooked night — refused while full,
 *     allowed once capacity is raised, and the player is seated again.
 *   - Weeknight: the registration goes back to CONFIRMED and the queue
 *     entry the rotation board's "Done" closed is WAITING again, at its
 *     original joinedQueueAt (the player keeps their place in line).
 *   - Undoing something that isn't checked out is refused.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayRegistrationService } from "./open-play-registration.service";

const FRIDAY = new Date(2031, 1, 7); // Friday, Feb 7 2031 — not used by other fixtures
const WEEKNIGHT = new Date(2031, 1, 10); // Monday, Feb 10 2031

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function expectRefusal(promise: Promise<unknown>, contains: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes(contains),
      `expected an error containing "${contains}", got: ${error}`,
    );
    return;
  }
  throw new Error(`FAIL: expected a refusal containing "${contains}", but it succeeded`);
}

async function cleanUp(): Promise<void> {
  const registrations = await prisma.openPlayNightRegistration.findMany({
    where: { date: { in: [FRIDAY, WEEKNIGHT] } },
    select: { id: true },
  });
  const ids = registrations.map((registration) => registration.id);
  await prisma.queueEntry.deleteMany({ where: { registrationId: { in: ids } } });
  await prisma.sale.deleteMany({ where: { openPlayNightRegistrationId: { in: ids } } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { id: { in: ids } } });
  await prisma.openPlayNightSession.deleteMany({ where: { date: FRIDAY } });
}

async function main(): Promise<void> {
  await cleanUp();
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  // ============== Fri/Sat: seat went to the waitlist ==============
  const session = await prisma.openPlayNightSession.create({
    data: {
      date: FRIDAY,
      startAt: new Date(2031, 1, 7, 18, 0),
      endAt: new Date(2031, 1, 7, 23, 0),
      capacity: 1,
    },
  });
  const seated = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Undo Checkout Seated", phone: "09170000401", skillLevel: "INTERMEDIATE" },
    owner.id,
  );
  const waiting = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Undo Checkout Waiting", phone: "09170000402", skillLevel: "INTERMEDIATE" },
    owner.id,
  );
  assert(waiting.waitlistPos === 1, "expected the second walk-in on the waitlist");

  await openPlayRegistrationService.markCheckedOut(seated.id, owner.id);
  const promoted = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: waiting.id } });
  assert(promoted.waitlistPos === null, "expected the check-out to promote the waitlist head");

  await expectRefusal(openPlayRegistrationService.undoCheckOut(seated.id, owner.id), "Tonight is full");
  const stillOut = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: seated.id } });
  assert(stillOut.status === "CHECKED_OUT", "a refused undo must leave the player checked out");
  console.log("PASS: undo is refused while the freed seat is taken — the night is never overbooked.");

  await prisma.openPlayNightSession.update({ where: { id: session.id }, data: { capacity: 2 } });
  await openPlayRegistrationService.undoCheckOut(seated.id, owner.id);
  const restored = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: seated.id } });
  assert(restored.status === "CONFIRMED", `expected CONFIRMED, got ${restored.status}`);
  assert(restored.checkedOutAt === null, "expected checkedOutAt cleared");
  assert(restored.waitlistPos === null, "expected the restored player seated, not waitlisted");
  console.log("PASS: with a seat free, undo puts the player back to CONFIRMED and seated.");

  await expectRefusal(openPlayRegistrationService.undoCheckOut(seated.id, owner.id), "isn't checked out");
  console.log("PASS: undoing a registration that isn't checked out is refused.");

  // ============== Weeknight: back in line at the same place ==============
  const joinedQueueAt = new Date(2031, 1, 10, 18, 5);
  const weeknight = await prisma.openPlayNightRegistration.create({
    data: {
      sessionId: null,
      date: WEEKNIGHT,
      playerName: "Undo Checkout Weeknight",
      phone: "09170000403",
      skillLevel: "INTERMEDIATE",
      source: "WALK_IN",
      status: "CHECKED_OUT",
      checkedOutAt: new Date(2031, 1, 10, 19, 0),
    },
  });
  await prisma.queueEntry.create({
    data: {
      registrationId: weeknight.id,
      date: WEEKNIGHT,
      playerName: weeknight.playerName,
      skillLevel: "INTERMEDIATE",
      joinedQueueAt,
      status: "DONE",
    },
  });

  await openPlayRegistrationService.undoCheckOut(weeknight.id, owner.id);
  const weeknightAfter = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: weeknight.id } });
  const queueAfter = await prisma.queueEntry.findUniqueOrThrow({ where: { registrationId: weeknight.id } });
  assert(weeknightAfter.status === "CONFIRMED", `expected CONFIRMED, got ${weeknightAfter.status}`);
  assert(queueAfter.status === "WAITING", `expected the queue entry WAITING, got ${queueAfter.status}`);
  assert(
    queueAfter.joinedQueueAt.getTime() === joinedQueueAt.getTime(),
    "expected the player's original place in line (joinedQueueAt unchanged)",
  );
  console.log("PASS: weeknight undo restores CONFIRMED and puts the player back in line at their original place.");

  await cleanUp();
  console.log("\nPASS: undo check-out proven against real rows.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await cleanUp().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
