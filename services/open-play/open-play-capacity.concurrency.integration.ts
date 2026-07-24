/**
 * Hardening phase (BUILD-SPEC.md §0 process rule — a failing test before
 * every fix, then confirmed passing after). Covers two capacity-service
 * findings from the six-item concurrency audit (BUILD-SPEC.md §15):
 *
 *   1. closeSession (fix 3/6) — the "no open tabs" check and the status
 *      write were not atomic. A tab could become non-zero in the gap
 *      between them, letting a session close with real money still
 *      outstanding. Phase 7 built this guard specifically to stop exactly
 *      that (BUILD-SPEC.md §9 correctness #6), and the guard was itself
 *      check-then-act — the clearest example of why this audit was
 *      needed: the thing meant to prevent the problem had the problem.
 *   2. getOrCreateSessionForDate (lower severity) — protected by
 *      OpenPlayNightSession.date's unique constraint, but the losing side
 *      of a concurrent race got an unhandled raw database error instead
 *      of gracefully returning the session the winner just created.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { playerTabService } from "./player-tab.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUpDate(date: Date): Promise<void> {
  const session = await prisma.openPlayNightSession.findUnique({ where: { date } });
  if (!session) return;
  const registrations = await prisma.openPlayNightRegistration.findMany({ where: { sessionId: session.id }, select: { id: true } });
  const ids = registrations.map((r) => r.id);
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
  const tabIds = tabs.map((t) => t.id);
  await prisma.sale.deleteMany({ where: { playerTabId: { in: tabIds } } });
  await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.gameAssignmentParticipant.deleteMany({ where: { registrationId: { in: ids } } });
  await prisma.gameAssignment.deleteMany({ where: { sessionId: session.id } });
  await prisma.queueEntry.deleteMany({ where: { sessionId: session.id } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: session.id } });
  await prisma.openPlayNightSession.delete({ where: { id: session.id } });
}

// Fixture: a Fri/Sat session with one checked-in player (zero-balance
// tab). Fires closeSession concurrently with a game credit landing on
// that same tab. Asserts the session is never CLOSED while that tab has
// a non-zero open balance — checked after the race, not assumed from
// which one "won".
async function testCloseSessionNeverClosesOverAnOpenBalance(friday: Date, courtId: string, actorUserId: string): Promise<void> {
  await cleanUpDate(friday);

  const session = await openPlayCapacityService.getOrCreateSessionForDate(friday);
  const registration = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Close Race Player", phone: "09920000", skillLevel: "INTERMEDIATE" },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);
  const tab = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tab, "checkIn should have opened a tab");
  assert(tab!.totalCents === 0, "tab should start at zero — Fri/Sat games bill ₱0");

  const creditGame = async () => {
    const assignment = await prisma.gameAssignment.create({
      data: { courtId, sessionId: session.id, date: session.date, skillSpread: 0, source: "AUTO", status: "DONE", startedAt: new Date(), endedAt: new Date() },
    });
    await prisma.gameAssignmentParticipant.create({ data: { assignmentId: assignment.id, registrationId: registration.id } });
    // Give this tab a real, non-zero balance the same way completeAssignment
    // does — a rental, not creditGame, since Fri/Sat games bill ₱0 and would
    // leave the tab at zero regardless of the race outcome.
    await playerTabService.addRentalLineItem(tab!.tab.id, "house_paddle", "Paddle rental", 1, actorUserId);
  };

  console.log("  Firing closeSession and a concurrent rental charge on the same session's tab...");
  await Promise.allSettled([
    openPlayCapacityService.closeSession(session.id, actorUserId),
    creditGame(),
  ]);

  const finalSession = await prisma.openPlayNightSession.findUniqueOrThrow({ where: { id: session.id } });
  const finalTab = await playerTabService.getTabView(tab!.tab.id);
  console.log(`  Session status: ${finalSession.status}, tab status: ${finalTab.tab.status}, tab total: ${finalTab.totalCents}`);

  const closedWithMoneyOutstanding = finalSession.status === "CLOSED" && finalTab.tab.status === "OPEN" && finalTab.totalCents > 0;
  assert(
    !closedWithMoneyOutstanding,
    `session closed while its tab had a ₱${(finalTab.totalCents / 100).toFixed(2)} open balance — the exact thing this guard exists to prevent`,
  );

  await cleanUpDate(friday);
  console.log("PASS: a session is never CLOSED while one of its tabs has a non-zero open balance");
}

// Fixture: no session yet exists for this date. Fires
// getOrCreateSessionForDate twice concurrently. One create wins; the
// loser used to surface OpenPlayNightSession.date's unique constraint as
// a raw, unhandled error instead of gracefully returning the row the
// winner just created.
async function testGetOrCreateSessionForDateNoOpsOnRace(saturday: Date): Promise<void> {
  await cleanUpDate(saturday);

  console.log("  Firing getOrCreateSessionForDate twice concurrently for a date with no existing session...");
  const results = await Promise.allSettled([
    openPlayCapacityService.getOrCreateSessionForDate(saturday),
    openPlayCapacityService.getOrCreateSessionForDate(saturday),
  ]);

  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  console.log(`  Rejected: ${rejected.length}${rejected.length ? ` — ${rejected[0].reason}` : ""}`);
  assert(
    rejected.length === 0,
    `a concurrent race to create the same date's session must resolve gracefully on both sides, not throw a raw DB error — got: ${rejected.map((r) => r.reason).join("; ")}`,
  );

  const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof openPlayCapacityService.getOrCreateSessionForDate>>> => r.status === "fulfilled");
  assert(fulfilled.length === 2, `expected both calls to resolve, got ${fulfilled.length}`);
  assert(fulfilled[0].value.id === fulfilled[1].value.id, "both concurrent calls must resolve to the same session row");

  const sessionCount = await prisma.openPlayNightSession.count({ where: { date: saturday } });
  assert(sessionCount === 1, `expected exactly 1 session row for this date, got ${sessionCount}`);

  await cleanUpDate(saturday);
  console.log("PASS: a concurrent race to create the same date's session resolves gracefully on both sides");
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });

  const upcoming = await openPlayCapacityService.getUpcomingNights(21);
  const friday = upcoming.find((n) => n.dayOfWeek === 5)?.date;
  const saturday = upcoming.find((n) => n.dayOfWeek === 6)?.date;
  assert(friday, "expected an upcoming Friday within 21 days");
  assert(saturday, "expected an upcoming Saturday within 21 days");

  try {
    await testCloseSessionNeverClosesOverAnOpenBalance(friday!, court.id, owner.id);
    await testGetOrCreateSessionForDateNoOpsOnRace(saturday!);
  } finally {
    await cleanUpDate(friday!);
    await cleanUpDate(saturday!);
  }

  console.log("\nAll capacity-service concurrency scenarios passed.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
