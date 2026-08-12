/**
 * Hardening (2026-08-12): getTodaysBalance(rolloverHour) moved "what
 * day is today" resolution out of the reconciliation page and into the
 * service itself — see that method's own comment in
 * gcash-reconciliation.service.ts. computeBusinessDate's own rollover
 * math is already unit-tested elsewhere (lib/business-date.test.ts);
 * this proves the WIRING — that getTodaysBalance genuinely threads its
 * rolloverHour argument into computeBusinessDate and delegates to
 * getOrCreateBalanceForDate, rather than ignoring the argument or
 * falling back to a raw toMidnight(new Date()).
 *
 * Seeds real rows for both literal today AND literal yesterday
 * directly (bypassing seedFirstBalance, which always targets literal
 * today), so getOrCreateBalanceForDate's findUnique short-circuit
 * returns each one deterministically regardless of whatever other real
 * history already exists in this dev database — no fake timers needed
 * (this plain-tsx harness has none), and no dependency on the real
 * wall-clock hour this test happens to run at:
 *   - rolloverHour = 0 never rolls back (Date#getHours() is never < 0)
 *     -> must resolve to the row seeded at literal today.
 *   - rolloverHour = 24 always rolls back (Date#getHours() is always
 *     < 24) -> must resolve to the row seeded at literal yesterday.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { gcashReconciliationService } from "./gcash-reconciliation.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function toMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

async function cleanUp(): Promise<void> {
  const today = toMidnight(new Date());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  await prisma.gcashDailyBalance.deleteMany({ where: { date: { in: [today, yesterday] } } });
}

async function main(): Promise<void> {
  await cleanUp();

  try {
    const today = toMidnight(new Date());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const seededToday = await prisma.gcashDailyBalance.create({
      data: { date: today, startingBalanceCents: 100000 },
    });
    const seededYesterday = await prisma.gcashDailyBalance.create({
      data: { date: yesterday, startingBalanceCents: 250000 },
    });

    const todayResult = await gcashReconciliationService.getTodaysBalance(0);
    assert(todayResult !== null, "expected getTodaysBalance(0) to find literal today's row");
    assert(
      todayResult!.id === seededToday.id,
      `expected getTodaysBalance(0) to resolve to today's row (${seededToday.id}), got ${todayResult!.id}`,
    );
    console.log("PASS: getTodaysBalance(0) resolves 'today' as literal today (no rollback).");

    const yesterdayResult = await gcashReconciliationService.getTodaysBalance(24);
    assert(yesterdayResult !== null, "expected getTodaysBalance(24) to find yesterday's row");
    assert(
      yesterdayResult!.id === seededYesterday.id,
      `expected getTodaysBalance(24) to resolve to yesterday's row (${seededYesterday.id}), got ${yesterdayResult!.id}`,
    );
    console.log("PASS: getTodaysBalance(24) resolves 'today' as literal yesterday (always rolls back) — the rolloverHour argument genuinely flows through, not ignored.");

    await cleanUp();
    console.log("\nPASS: getTodaysBalance wiring proven against real rows.");
  } catch (error) {
    await cleanUp();
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
