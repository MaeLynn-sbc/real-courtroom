/**
 * Cash's twin of services/gcash/gcash-reconciliation-todays-balance.
 * integration.ts — same hardening (2026-08-12), same wiring proof,
 * applied to CashReconciliationService instead. See that file's own
 * comment for the full reasoning.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { cashReconciliationService } from "./cash-reconciliation.service";

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
  await prisma.cashDailyBalance.deleteMany({ where: { date: { in: [today, yesterday] } } });
}

async function main(): Promise<void> {
  await cleanUp();

  try {
    const today = toMidnight(new Date());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const seededToday = await prisma.cashDailyBalance.create({
      data: { date: today, startingBalanceCents: 100000 },
    });
    const seededYesterday = await prisma.cashDailyBalance.create({
      data: { date: yesterday, startingBalanceCents: 250000 },
    });

    const todayResult = await cashReconciliationService.getTodaysBalance(0);
    assert(todayResult !== null, "expected getTodaysBalance(0) to find literal today's row");
    assert(
      todayResult!.id === seededToday.id,
      `expected getTodaysBalance(0) to resolve to today's row (${seededToday.id}), got ${todayResult!.id}`,
    );
    console.log("PASS: getTodaysBalance(0) resolves 'today' as literal today (no rollback).");

    const yesterdayResult = await cashReconciliationService.getTodaysBalance(24);
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
