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
 * ITERATION COUNT: a single race is thin evidence for something that
 * only manifests under contention/timing — Postgres deadlock detection
 * runs on a ~1s cycle (deadlock_timeout), so a single pair of concurrent
 * calls has a real chance of just missing each other even if a genuine
 * ordering conflict existed. Repeated 25x in one process (fresh
 * concurrent pair each iteration, same tab) rather than relying on
 * manual repeated `npx tsx` invocations during investigation, so this
 * coverage is what actually runs under `npm run test:integration`, not
 * just what ran once during development.
 *
 * ONLY ONE REAL LOCK CHAIN EXISTS TODAY — checked, not assumed. checkIn's
 * party branch locks OpenPlayNightRegistration, then (after committing
 * the party's arrival) calls playerTabService.getOrCreateTab for each
 * member — but getOrCreateTab never acquires FOR UPDATE on PlayerTab
 * (confirmed: grep across player-tab.service.ts shows only
 * lockAndCheckTabOpen and assertSessionNotClosed ever issue a `FOR
 * UPDATE`; getOrCreateTab and creditGame do not). It's a plain read
 * (existing tab) or a fresh INSERT (new tab) either way — never a lock
 * a concurrent transaction could be waiting on. There is no code path
 * that holds a PlayerTab lock and then tries to lock
 * OpenPlayNightRegistration, so a "Registration-then-PlayerTab" chain,
 * and any deadlock built from it, does not exist to test. If
 * getOrCreateTab or creditGame is ever changed to take an explicit
 * PlayerTab lock, this file is where that second chain's test belongs.
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
const ITERATIONS = 25;

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

  console.log(`  Firing addRentalLineItem and addAdjustment concurrently against the same session-backed tab, ${ITERATIONS}x...`);
  let totalRejected = 0;
  let totalDeadlocked = 0;
  const deadlockDetails: string[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const results = await withTimeout(
      Promise.allSettled([
        playerTabService.addRentalLineItem(tab!.tab.id, "house_paddle", `Paddle rental ${i}`, 1, owner.id),
        playerTabService.addAdjustment(tab!.tab.id, `Manual correction ${i}`, 5, `Lock order test ${i}`, owner.id),
      ]),
      TIMEOUT_MS,
      `addRentalLineItem/addAdjustment race (iteration ${i})`,
    );

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    const deadlocked = rejected.filter((r) => isDeadlockError(r.reason));
    totalRejected += rejected.length;
    totalDeadlocked += deadlocked.length;
    if (deadlocked.length > 0) {
      deadlockDetails.push(`iteration ${i}: ${deadlocked.map((r) => r.reason).join("; ")}`);
    }
  }

  console.log(`  Total rejected: ${totalRejected}/${ITERATIONS * 2}, deadlock errors: ${totalDeadlocked}`);
  assert(totalDeadlocked === 0, `Postgres reported a real deadlock (40P01) in ${totalDeadlocked}/${ITERATIONS} iterations — the two-lock chain is not safe under concurrency:\n${deadlockDetails.join("\n")}`);
  assert(totalRejected === 0, `expected every call across all ${ITERATIONS} iterations to succeed (same lock order, no genuine conflict) — got ${totalRejected} rejections`);

  const finalTab = await playerTabService.getTabView(tab!.tab.id);
  console.log(`  Final tab total: ${finalTab.totalCents}`);
  assert(finalTab.totalCents > 0, "every rental and adjustment across all iterations should have landed on the tab");

  await cleanUpFriday(friday!);
  console.log(`PASS: addRentalLineItem and addAdjustment, fired concurrently against the same locks ${ITERATIONS}x, neither hung nor deadlocked`);
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
