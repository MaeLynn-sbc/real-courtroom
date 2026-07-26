/**
 * Open-play online self-registration, Gate 2 review follow-up — proves
 * getUpcomingNights now surfaces registered/waitlisted counts per
 * night, closing the blind spot where a registration landing weeks
 * ahead of a session (once the lead-time window opens) was invisible
 * anywhere except that exact date's own roster page.
 *
 * Uses a REAL near-future Friday (via getUpcomingNights itself, same
 * convention as open-play-capacity.concurrency.integration.ts) rather
 * than a fixed far-future fixture date, since getUpcomingNights only
 * ever generates dates starting from the real "today."
 *
 * registeredCount reuses the exact "occupied seat" predicate
 * (countOccupiedSeats) already used everywhere else in this feature —
 * a walk-in's seat counts too, not just online holds. waitlistedCount
 * is deliberately scoped to OpenPlayWaitlistEntry only (the online
 * waitlist), not the separate legacy walk-in-overflow concept
 * (OpenPlayNightRegistration.waitlistPos) — a walk-in physically can't
 * register weeks in advance, so for the "see a future night at a
 * glance" use case this list exists for, the online waitlist is the
 * only one that can ever be non-empty on a date staff haven't visited
 * yet.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUpDate(date: Date): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date } });
  if (existing) {
    await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  const upcomingBefore = await openPlayCapacityService.getUpcomingNights(21);
  const friday = upcomingBefore.find((n) => n.dayOfWeek === 5)?.date;
  assert(friday, "expected an upcoming Friday within 21 days");

  await cleanUpDate(friday!);

  try {
    const session = await openPlayCapacityService.setSessionCapacityOverride(friday!, 2, owner.id);

    await openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: "Count Walk-in A", phone: "09170000080", skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    await openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: "Count Walk-in B", phone: "09170000081", skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    // Capacity is now full (2/2) — this lands on the online waitlist,
    // not a registration row, exactly like a real over-capacity online
    // submission would (submitOnlineRegistration is the same method
    // the public path calls; this test exercises it directly, bypassing
    // the two-gate/lead-time checks that aren't what this test is
    // about).
    const waitlistResult = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "Count Online Waiter",
      phone: "09170000082",
      skillLevel: "INTERMEDIATE",
    });
    assert(waitlistResult.kind === "waitlisted", `expected the third submission waitlisted (full), got ${waitlistResult.kind}`);

    const upcomingAfter = await openPlayCapacityService.getUpcomingNights(21);
    const fridayAfter = upcomingAfter.find((n) => n.date.getTime() === friday!.getTime());
    assert(fridayAfter, "expected the same Friday to still be in the upcoming list");
    console.log(`Friday row: registeredCount=${fridayAfter!.registeredCount}, waitlistedCount=${fridayAfter!.waitlistedCount}`);
    assert(fridayAfter!.registeredCount === 2, `expected registeredCount 2 (both walk-ins), got ${fridayAfter!.registeredCount}`);
    assert(fridayAfter!.waitlistedCount === 1, `expected waitlistedCount 1 (the online waiter), got ${fridayAfter!.waitlistedCount}`);
    console.log("PASS: getUpcomingNights surfaces the correct registered/waitlisted counts without navigating to the date's own roster.");

    // A date with no session row at all must read as 0/0, not throw or
    // omit the field.
    const untouchedNight = upcomingAfter.find((n) => !n.isOverride);
    if (untouchedNight) {
      assert(untouchedNight.registeredCount === 0, "expected a night with no session row to read registeredCount 0");
      assert(untouchedNight.waitlistedCount === 0, "expected a night with no session row to read waitlistedCount 0");
      console.log("PASS: a night with no session row yet reads 0/0, not an error.");
    }

    await cleanUpDate(friday!);
  } catch (error) {
    await cleanUpDate(friday!);
    throw error;
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
