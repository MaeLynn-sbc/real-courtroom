/**
 * Owner request (2026-08-08): "add in the account reports the amount of
 * money for deposit and the starting money" — the Reports page only ever
 * showed Sale-sourced revenue (Cash/GCash collected), never the drawer/
 * float state that lives on CashDailyBalance/GcashDailyBalance instead.
 *
 * Proves, against real rows, reportingService.getCashPositionSummary:
 *   1. "Starting balance" is the range's OPENING float — the earliest
 *      daily-balance row on or after range.from — not a sum across days
 *      (summing would double-count the same money as it carries forward).
 *   2. "Cash deposited" sums CashDailyBalance.withdrawnCents across every
 *      day in range (GCash has no equivalent — never asserted here).
 *   3. A range with no daily-balance rows at all resolves both starting
 *      balances to null (not 0) — "no data," not a real zero float.
 *
 * Uses fixed, far-past isolated dates (safely outside any real business
 * date this app has ever operated on) — same convention as
 * cash-reconciliation-midnight-shift-carryover.integration.ts.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { reportingService } from "./reporting.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const DAY_ONE = new Date(2021, 4, 10); // arbitrary, isolated, real-past dates
const DAY_TWO = new Date(2021, 4, 11);
const DAY_THREE = new Date(2021, 4, 12);
const EMPTY_RANGE_START = new Date(2021, 4, 20);
const EMPTY_RANGE_END = new Date(2021, 4, 21);

async function cleanUp(): Promise<void> {
  const allDates = [DAY_ONE, DAY_TWO, DAY_THREE];
  await prisma.cashDailyBalance.deleteMany({ where: { date: { in: allDates } } });
  await prisma.gcashDailyBalance.deleteMany({ where: { date: { in: allDates } } });
}

async function main(): Promise<void> {
  await cleanUp();

  try {
    // Day one: opening float ₱5,000, ₱1,000 deposited at close.
    await prisma.cashDailyBalance.create({
      data: { date: DAY_ONE, startingBalanceCents: 500_000, withdrawnCents: 100_000, status: "CONFIRMED" },
    });
    // Day two: carries forward as ₱4,000 starting, ₱2,000 deposited.
    await prisma.cashDailyBalance.create({
      data: { date: DAY_TWO, startingBalanceCents: 400_000, withdrawnCents: 200_000, status: "CONFIRMED" },
    });
    // Day three: still open, nothing withdrawn yet.
    await prisma.cashDailyBalance.create({
      data: { date: DAY_THREE, startingBalanceCents: 200_000, withdrawnCents: 0, status: "OPEN" },
    });
    await prisma.gcashDailyBalance.create({
      data: { date: DAY_ONE, startingBalanceCents: 300_000, status: "CONFIRMED" },
    });
    await prisma.gcashDailyBalance.create({
      data: { date: DAY_TWO, startingBalanceCents: 150_000, status: "CONFIRMED" },
    });

    const rangeEnd = new Date(DAY_THREE);
    rangeEnd.setHours(23, 59, 59, 999);
    const summary = await reportingService.getCashPositionSummary({ from: DAY_ONE, to: rangeEnd });

    assert(
      summary.cashStartingBalanceCents === 500_000,
      `expected the range's cash starting balance to be day one's ₱5,000 (the earliest row), got ${summary.cashStartingBalanceCents}`,
    );
    assert(
      summary.cashDepositedCents === 300_000,
      `expected cashDepositedCents to sum all three days' withdrawnCents (₱1,000 + ₱2,000 + ₱0 = ₱3,000), got ${summary.cashDepositedCents}`,
    );
    assert(
      summary.gcashStartingBalanceCents === 300_000,
      `expected the range's GCash starting balance to be day one's ₱3,000 (the earliest row), got ${summary.gcashStartingBalanceCents}`,
    );
    console.log(
      "PASS: starting balance is the range's earliest row (not a sum), and deposited sums withdrawnCents across every day.",
    );

    // A range starting AFTER day one excludes it — day two becomes the
    // new earliest row, proving this isn't just "the first row ever."
    const midRangeEnd = new Date(DAY_THREE);
    midRangeEnd.setHours(23, 59, 59, 999);
    const midRangeSummary = await reportingService.getCashPositionSummary({
      from: DAY_TWO,
      to: midRangeEnd,
    });
    assert(
      midRangeSummary.cashStartingBalanceCents === 400_000,
      `expected a range starting on day two to report day two's ₱4,000 as the starting balance, got ${midRangeSummary.cashStartingBalanceCents}`,
    );
    console.log("PASS: the earliest row WITHIN the range wins, not the earliest row ever.");

    // No daily-balance rows at all in this range — starting balances must
    // be null (no data), not a misleading real zero.
    const emptySummary = await reportingService.getCashPositionSummary({
      from: EMPTY_RANGE_START,
      to: EMPTY_RANGE_END,
    });
    assert(
      emptySummary.cashStartingBalanceCents === null,
      `expected a range with no CashDailyBalance rows to report null, got ${emptySummary.cashStartingBalanceCents}`,
    );
    assert(
      emptySummary.gcashStartingBalanceCents === null,
      `expected a range with no GcashDailyBalance rows to report null, got ${emptySummary.gcashStartingBalanceCents}`,
    );
    assert(
      emptySummary.cashDepositedCents === 0,
      `expected cashDepositedCents to be a real 0 (not null) when no rows exist, got ${emptySummary.cashDepositedCents}`,
    );
    console.log(
      "PASS: an empty range reports null starting balances (no data) but a real 0 deposited total.",
    );

    await cleanUp();
  } catch (error) {
    await cleanUp();
    throw error;
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
