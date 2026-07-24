/**
 * Hardening phase (BUILD-SPEC.md §0 process rule — a failing test before
 * every fix, then confirmed passing after). Covers two checkIn findings
 * from the six-item concurrency audit (BUILD-SPEC.md §15):
 *
 *   1. checkIn (party path, fix 5/6) — "has everyone arrived?" was decided
 *      from a plain (unlocked) findMany, run inside each member's OWN
 *      transaction. Two members of the same party checking in at the same
 *      moment each run in a separate transaction — under READ COMMITTED,
 *      neither can see the other's still-uncommitted arrival, so both
 *      independently conclude "not everyone's here yet." The party never
 *      enters the queue at all — no error, no retry, just silence.
 *   2. checkIn (solo path, lower severity) — protected against duplicate
 *      rows by real unique constraints (QueueEntry.registrationId,
 *      PlayerTab.registrationId), but the losing side of a concurrent
 *      double-tap on the SAME registration got an unhandled raw database
 *      error instead of the graceful "already checked in" no-op the
 *      sequential double-tap path already provides.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";

import { createBarrier } from "../../lib/race-test-hooks";
import { prisma } from "../../lib/prisma";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";

// Committed, not a one-off investigation delay. Without synchronization,
// two independent checkIn() calls' connection-acquisition/scheduling
// jitter swamps the party path's naturally narrow race window — measured
// passing 19/19 combined runs against KNOWN-UNLOCKED code, a test that
// cannot fail. `beforeRead` is a 2-party rendezvous barrier: it forces
// both concurrent calls to start their transaction's DB work at the same
// instant, closing out that jitter deterministically instead of hoping a
// fixed delay happens to be wide enough. `beforePartyDecision` then adds
// a small delay at the specific vulnerable read, harmless when the party
// lock is present (the loser is already blocked on the DB lock itself by
// then, not on this delay) but decisive if that lock is ever regressed
// away.
const PARTY_DECISION_DELAY_MS = 100;
function partyRaceHooks() {
  const beforeRead = createBarrier(2);
  return {
    member1: { beforeRead, beforePartyDecision: () => new Promise<void>((resolve) => setTimeout(resolve, PARTY_DECISION_DELAY_MS)) },
    member2: { beforeRead, beforePartyDecision: () => new Promise<void>((resolve) => setTimeout(resolve, PARTY_DECISION_DELAY_MS)) },
  };
}

const PARTY_RACE_DATE = new Date(2031, 1, 17); // Monday
const SOLO_DOUBLE_TAP_DATE = new Date(2031, 1, 18); // Tuesday

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUpDate(date: Date): Promise<void> {
  const registrations = await prisma.openPlayNightRegistration.findMany({ where: { date }, select: { id: true } });
  const ids = registrations.map((r) => r.id);
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
  const tabIds = tabs.map((t) => t.id);
  await prisma.sale.deleteMany({ where: { playerTabId: { in: tabIds } } });
  await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.queueEntry.deleteMany({ where: { date } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { date } });
}

async function cleanUp(): Promise<void> {
  await cleanUpDate(PARTY_RACE_DATE);
  await cleanUpDate(SOLO_DOUBLE_TAP_DATE);
}

// Fixture: a 2-person party, both members registered but not yet checked
// in. Fires checkIn for both members concurrently. The corruption is BOTH
// members ending up checkedInAt-set with NO queue entries for either —
// the party silently never joined the queue.
async function testPartyNeverSilentlyDropsOutOfTheQueue(actorUserId: string): Promise<void> {
  const partyId = randomUUID();

  const member1 = await openPlayRegistrationService.registerWeeknightWalkIn(
    PARTY_RACE_DATE,
    { playerName: "Party Race Member 1", phone: "09940001", skillLevel: "INTERMEDIATE", partyId },
    actorUserId,
  );
  const member2 = await openPlayRegistrationService.registerWeeknightWalkIn(
    PARTY_RACE_DATE,
    { playerName: "Party Race Member 2", phone: "09940002", skillLevel: "INTERMEDIATE", partyId },
    actorUserId,
  );

  const hooks = partyRaceHooks();
  console.log("  Firing checkIn for both party members concurrently (synchronized start)...");
  await Promise.allSettled([
    openPlayCheckinService.checkIn(member1.id, actorUserId, hooks.member1),
    openPlayCheckinService.checkIn(member2.id, actorUserId, hooks.member2),
  ]);

  const finalMembers = await prisma.openPlayNightRegistration.findMany({ where: { partyId, date: PARTY_RACE_DATE } });
  const queueEntries = await prisma.queueEntry.findMany({ where: { partyId, date: PARTY_RACE_DATE } });
  const bothArrived = finalMembers.every((m) => m.checkedInAt !== null);
  console.log(`  Both checked in: ${bothArrived}, queue entries created: ${queueEntries.length}`);

  assert(
    !(bothArrived && queueEntries.length === 0),
    "both party members arrived but no queue entries exist — the party silently never joined the queue",
  );
  if (bothArrived) {
    assert(queueEntries.length === 2, `expected exactly 2 queue entries for a fully-arrived 2-person party, got ${queueEntries.length}`);
  }

  console.log("PASS: a fully-arrived party always ends up with queue entries for every member");
}

// Fixture: one solo registration, checkIn fired twice concurrently against
// the SAME registrationId. Both transactions read checkedInAt as null
// before either commits, so both proceed to create a QueueEntry/PlayerTab
// — one wins, the other used to surface a raw P2002 instead of the
// graceful "already checked in" no-op the sequential double-tap gets.
async function testSoloDoubleTapNoOps(actorUserId: string): Promise<void> {
  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    SOLO_DOUBLE_TAP_DATE,
    { playerName: "Solo Double Tap", phone: "09960001", skillLevel: "INTERMEDIATE" },
    actorUserId,
  );

  console.log("  Firing checkIn twice concurrently against the same solo registration...");
  const results = await Promise.allSettled([
    openPlayCheckinService.checkIn(registration.id, actorUserId),
    openPlayCheckinService.checkIn(registration.id, actorUserId),
  ]);

  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  console.log(`  Rejected: ${rejected.length}${rejected.length ? ` — ${rejected[0].reason}` : ""}`);
  assert(
    rejected.length === 0,
    `a concurrent double-tap on the same registration must resolve gracefully on both sides, not throw a raw DB error — got: ${rejected.map((r) => r.reason).join("; ")}`,
  );

  const queueEntries = await prisma.queueEntry.findMany({ where: { registrationId: registration.id } });
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: registration.id } });
  assert(queueEntries.length === 1, `expected exactly 1 queue entry for a double-tapped solo check-in, got ${queueEntries.length}`);
  assert(tabs.length === 1, `expected exactly 1 tab for a double-tapped solo check-in, got ${tabs.length}`);

  console.log("PASS: a concurrent double-tap on a solo check-in resolves gracefully on both sides");
}

async function main(): Promise<void> {
  await cleanUp();
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  try {
    await testPartyNeverSilentlyDropsOutOfTheQueue(owner.id);
    await testSoloDoubleTapNoOps(owner.id);
  } finally {
    await cleanUp();
  }

  console.log("\nAll check-in concurrency scenarios passed.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUp().catch(() => undefined);
  process.exit(1);
});
