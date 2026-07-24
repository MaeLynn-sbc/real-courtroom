/**
 * Hardening phase (BUILD-SPEC.md §0/§15 process rule) — item 3 of the
 * lock-order follow-up: `FOR UPDATE` now exists across five services and
 * four tables (QueueEntry, GameAssignment, PlayerTab, Registration,
 * Session), documented in §15's canonical lock order. A path that ever
 * acquires two of these in the opposite order to another path is a
 * deadlock waiting for a busy night — and no existing correctness test
 * would catch it, since deadlocks aren't about wrong data, they're about
 * two transactions each waiting on a lock the other holds.
 *
 * addRentalLineItem and addAdjustment are the two DIFFERENT call paths
 * that share the only two-table lock chain in the codebase today:
 * PlayerTab (lockAndCheckTabOpen) THEN OpenPlayNightSession
 * (assertSessionNotClosed), in that order, both via the same private
 * helpers. Firing both concurrently against the SAME tab is the
 * concrete "two paths, overlapping locks" scenario BUILD-SPEC.md §15
 * asks to prove doesn't deadlock — same order on both sides, so no
 * deadlock is expected, but this proves it live rather than only
 * reasoning about it, and stands as a regression guard: if a future
 * change ever makes one of these methods acquire the two locks in the
 * opposite order, this test starts failing (as a Postgres-detected
 * deadlock, error code 40P01, or as a hang caught by the timeout guard
 * below).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { playerTabService } from "./player-tab.service";

const TIMEOUT_MS = 10_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function isDeadlockError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const meta = (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } }).meta;
  return meta?.driverAdapterError?.cause?.originalCode === "40P01";
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`FAIL: ${label} did not resolve within ${ms}ms — looks like a real hang, not just a slow query`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function cleanUpFriday(friday: Date): Promise<void> {
  const session = await prisma.openPlayNightSession.findUnique({ where: { date: friday } });
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
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  const upcoming = await openPlayCapacityService.getUpcomingNights(21);
  const friday = upcoming.find((n) => n.dayOfWeek === 5)?.date;
  assert(friday, "expected an upcoming Friday within 21 days");
  await cleanUpFriday(friday!);

  // A Fri/Sat tab (sessionId set) is required — a weeknight tab has no
  // session to lock, and addRentalLineItem/addAdjustment skip
  // assertSessionNotClosed entirely when tab.sessionId is null, so a
  // weeknight fixture wouldn't exercise the two-lock chain at all.
  const session = await openPlayCapacityService.getOrCreateSessionForDate(friday!);
  const registration = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Lock Order Player", phone: "09970000", skillLevel: "INTERMEDIATE" },
    owner.id,
  );
  await openPlayCheckinService.checkIn(registration.id, owner.id);
  const tab = await playerTabService.getTabViewByRegistration(registration.id);
  assert(tab, "checkIn should have opened a tab");
  assert(tab!.tab.sessionId, "expected a Fri/Sat tab with a sessionId, to actually exercise the PlayerTab -> Session lock chain");

  console.log("  Firing addRentalLineItem and addAdjustment concurrently against the same session-backed tab...");
  const results = await withTimeout(
    Promise.allSettled([
      playerTabService.addRentalLineItem(tab!.tab.id, "house_paddle", "Paddle rental", 1, owner.id),
      playerTabService.addAdjustment(tab!.tab.id, "Manual correction", 500, "Lock order test", owner.id),
    ]),
    TIMEOUT_MS,
    "addRentalLineItem/addAdjustment race",
  );

  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  const deadlocked = rejected.filter((r) => isDeadlockError(r.reason));
  console.log(`  Rejected: ${rejected.length}, deadlock errors: ${deadlocked.length}`);
  assert(deadlocked.length === 0, `Postgres reported a real deadlock (40P01) — the two-lock chain is not safe under concurrency: ${deadlocked.map((r) => r.reason).join("; ")}`);
  assert(rejected.length === 0, `expected both calls to succeed (same lock order, no genuine conflict) — got: ${rejected.map((r) => r.reason).join("; ")}`);

  const finalTab = await playerTabService.getTabView(tab!.tab.id);
  console.log(`  Final tab total: ${finalTab.totalCents}`);
  assert(finalTab.totalCents > 0, "both the rental and the adjustment should have landed on the tab");

  await cleanUpFriday(friday!);
  console.log("PASS: addRentalLineItem and addAdjustment, fired concurrently against the same locks, neither hang nor deadlock");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
