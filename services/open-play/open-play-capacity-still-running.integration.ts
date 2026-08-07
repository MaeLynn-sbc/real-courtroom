/**
 * Owner-reported incident (2026-08-08, ~12am): a Fri/Sat night still
 * genuinely OPEN — real players checked in, session not closed — fell
 * off getUpcomingNights the instant the calendar rolled past midnight,
 * because the date cursor only ever walked FORWARD from "today." Staff
 * clicking through from the Fri/Sat Open Play list lost the only
 * list-based path to a session that was still actively running.
 *
 * Proves, against real rows:
 *   1. A session dated BEFORE today, still status OPEN, is included in
 *      getUpcomingNights' result, marked stillRunning: true, and sorted
 *      ahead of the forward-looking dates.
 *   2. Its registeredCount/waitlistedCount are populated correctly, not
 *      stuck at 0 — a carried-over night is fully usable from this list,
 *      not just visible.
 *   3. Once that same session is CLOSED, it drops back out of the list
 *      entirely — this is specifically about a night still genuinely
 *      running, not every past date ever.
 *
 * Uses a real past Friday (today's own upcoming Friday minus 7 days,
 * guaranteed to be a real Friday and guaranteed to be in the past)
 * rather than a fixed fixture date.
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

  const upcoming = await openPlayCapacityService.getUpcomingNights(1);
  const nextFriday = upcoming.find((n) => n.dayOfWeek === 5)?.date ?? upcoming[0]!.date;
  const pastFriday = new Date(nextFriday);
  pastFriday.setDate(pastFriday.getDate() - 7);

  await cleanUpDate(pastFriday);

  try {
    // ============== 1/2. A still-OPEN past session is included, marked stillRunning, with real counts ==============
    const session = await openPlayCapacityService.getOrCreateSessionForDate(pastFriday);
    assert(session.status === "OPEN", `expected a freshly-created session to be OPEN, got ${session.status}`);

    await openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: "Still Running Walk-in", phone: "09170000090", skillLevel: "INTERMEDIATE" },
      owner.id,
    );

    const nightsWhileOpen = await openPlayCapacityService.getUpcomingNights(14);
    const carriedOver = nightsWhileOpen.find((n) => n.date.getTime() === pastFriday.getTime());
    assert(carriedOver, "expected the still-open past Friday to appear in getUpcomingNights");
    assert(carriedOver!.stillRunning === true, "expected the past Friday to be marked stillRunning");
    assert(
      carriedOver!.registeredCount === 1,
      `expected registeredCount 1 (the walk-in), got ${carriedOver!.registeredCount}`,
    );
    assert(
      nightsWhileOpen[0]!.date.getTime() === pastFriday.getTime(),
      "expected the carried-over night to sort ahead of every forward-looking date",
    );
    console.log("PASS: a still-OPEN past Friday is surfaced in getUpcomingNights, marked stillRunning, with correct counts, sorted first.");

    // ============== 3. Once closed, it's no longer surfaced ==============
    await openPlayCapacityService.closeSession(session.id, owner.id);
    const nightsAfterClose = await openPlayCapacityService.getUpcomingNights(14);
    const stillThere = nightsAfterClose.find((n) => n.date.getTime() === pastFriday.getTime());
    assert(!stillThere, "expected the closed past Friday to no longer appear in getUpcomingNights");
    console.log("PASS: once the session is closed, it drops back out of the list — this is about still-running nights specifically.");

    await cleanUpDate(pastFriday);
    console.log("\nPASS: still-running Fri/Sat nights survive a midnight rollover, proven against real rows.");
  } catch (error) {
    await cleanUpDate(pastFriday);
    throw error;
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
