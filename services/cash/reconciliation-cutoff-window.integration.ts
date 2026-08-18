/**
 * Owner decision (2026-08-18), option B: bound the excludeBefore cutoff to
 * a window instead of trusting it unconditionally.
 *
 * THE BUG. getExpectedEndingBalance passes the PREVIOUS day's confirmedAt
 * to getCashSalesForDate as a raw createdAt floor. The day is selected by
 * businessDate but then filtered by a raw timestamp — two different axes.
 * When a day is confirmed LATE, that floor lands after the whole of the
 * next day's trading and excludes every sale, so a fully-populated day
 * reports zero and staff cannot close it.
 *
 * Reproduced on real production data: business date 2026-08-04 computes
 * PHP 4,580.00 of cash sales normally and PHP 0.00 through the cutoff,
 * because 2026-08-03 was not confirmed until 08-08 01:17 — five days late,
 * and after Aug 4 had already been closed.
 *
 * THE FIX. Apply the cutoff only when the previous day's confirmedAt falls
 * inside THAT DAY'S OWN business-day window, derived from the STORED
 * rollover hour (not a literal 3). A previous day closed within its own
 * window is a timely close whose timestamp is a meaningful "already
 * physically counted" boundary. A confirm days later says nothing about
 * what was in the drawer, so it is ignored.
 *
 * Proves, against real rows, for BOTH ledgers (they are twins and must not
 * diverge):
 *   1. Late previous-day confirm -> cutoff IGNORED, sales counted.
 *   2. Timely previous-day confirm inside its own window -> cutoff APPLIED.
 *   3. Null previous-day confirmedAt -> unchanged behaviour.
 *   4. Cash and GCash agree exactly on the same fixtures.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { getBusinessDateRange } from "../../lib/business-date";
import { prisma } from "../../lib/prisma";
import { cashReconciliationService } from "./cash-reconciliation.service";
import { gcashReconciliationService } from "../gcash/gcash-reconciliation.service";
import { settingsService } from "../settings/settings.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

// Far-future, isolated from every other fixture date this session.
const PREV_DAY = new Date(2031, 6, 14); // Mon 14 Jul 2031
const DAY = new Date(2031, 6, 15); // the day being computed

const STARTING = 100000; // PHP 1,000.00
const SALE_AMOUNT = 45800; // PHP 458.00 — echoes the real Aug 4 figure

function at(base: Date, dayOffset: number, hour: number, minute = 0): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, minute);
}

async function cleanUp(): Promise<void> {
  await prisma.sale.deleteMany({ where: { saleNumber: { startsWith: "SALE-CUTOFFTEST-" } } });
  for (const date of [PREV_DAY, DAY]) {
    await prisma.cashDailyBalance.deleteMany({ where: { date } });
    await prisma.gcashDailyBalance.deleteMany({ where: { date } });
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });
  const { businessDateRolloverHour } = await settingsService.getCourtHours();

  await cleanUp();
  const shift = await prisma.shift.create({
    data: { shiftNumber: `SHIFT-CUTOFF-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
  });

  // The window the fix keys off. Under rollover 3 this is
  // [14 Jul 03:00, 15 Jul 03:00) — so a confirm at 15 Jul 00:54 is INSIDE
  // the previous day's own window, while one on 19 Jul is far outside.
  const prevWindow = getBusinessDateRange(PREV_DAY, businessDateRolloverHour);

  // A sale bucketed to DAY but created BEFORE the timely cutoff. Written
  // directly because the ordinary path cannot produce this pair outside
  // Open Play (createSale derives businessDate from createdAt), and this
  // is exactly the Aug 8 shape: money physically counted in the previous
  // close but belonging to the next business day.
  async function makeSale(paymentMethodId: string, suffix: string, createdAt: Date) {
    return prisma.sale.create({
      data: {
        saleNumber: `SALE-CUTOFFTEST-${suffix}-${Date.now()}`,
        createdAt,
        businessDate: DAY,
        category: "OTHER",
        source: "RECEPTION",
        amountCents: SALE_AMOUNT,
        paymentMethodId,
        employeeId: employee.id,
        shiftId: shift.id,
        status: "COMPLETED",
      },
    });
  }

  try {
    // Sales sit mid-morning on DAY, comfortably after any timely cutoff.
    await makeSale(cashMethod.id, "cash-main", at(DAY, 0, 10, 0));
    await makeSale(gcashMethod.id, "gcash-main", at(DAY, 0, 10, 0));

    const balanceShape = { date: DAY, startingBalanceCents: STARTING };
    const expectedWithSale = STARTING + SALE_AMOUNT;

    // ============== 3. Null previous confirmedAt — unchanged behaviour ==============
    await prisma.cashDailyBalance.create({
      data: { date: PREV_DAY, startingBalanceCents: 0, status: "OPEN" },
    });
    await prisma.gcashDailyBalance.create({
      data: { date: PREV_DAY, startingBalanceCents: 0, status: "OPEN" },
    });

    const cashNullCutoff = await cashReconciliationService.getExpectedEndingBalance(balanceShape);
    const gcashNullCutoff = await gcashReconciliationService.getExpectedEndingBalance(balanceShape);
    assert(
      cashNullCutoff === expectedWithSale,
      `null cutoff (cash): expected ${expectedWithSale}, got ${cashNullCutoff}`,
    );
    assert(
      gcashNullCutoff === expectedWithSale,
      `null cutoff (gcash): expected ${expectedWithSale}, got ${gcashNullCutoff}`,
    );
    console.log("PASS: a null previous-day confirmedAt behaves exactly as before — no cutoff applied.");

    // ============== 1. LATE previous-day confirm — cutoff IGNORED ==============
    // The real Aug 4 shape: previous day confirmed days later, long after
    // this day's sales. Outside the previous day's own window, so ignored.
    const lateConfirm = at(PREV_DAY, 5, 1, 17); // 19 Jul 01:17
    assert(
      lateConfirm >= prevWindow.end,
      "fixture check: the late confirm must fall OUTSIDE the previous day's window",
    );
    for (const table of ["cashDailyBalance", "gcashDailyBalance"] as const) {
      await (prisma[table] as typeof prisma.cashDailyBalance).update({
        where: { date: PREV_DAY },
        data: { status: "CONFIRMED", confirmedAt: lateConfirm, confirmedEndingBalanceCents: 0 },
      });
    }

    const cashLate = await cashReconciliationService.getExpectedEndingBalance(balanceShape);
    const gcashLate = await gcashReconciliationService.getExpectedEndingBalance(balanceShape);
    assert(
      cashLate === expectedWithSale,
      `late confirm (cash): cutoff should be IGNORED — expected ${expectedWithSale}, got ${cashLate}`,
    );
    assert(
      gcashLate === expectedWithSale,
      `late confirm (gcash): cutoff should be IGNORED — expected ${expectedWithSale}, got ${gcashLate}`,
    );
    console.log("PASS: a previous day confirmed days late has its cutoff ignored — the day is no longer zeroed.");

    // ============== 2. TIMELY confirm inside its own window — cutoff APPLIED ==============
    // The Aug 8 shape: previous day closed at 00:54, inside its own window
    // under rollover 3. A sale created before that moment but bucketed to
    // DAY was physically counted in that close, so it must be excluded.
    const timelyConfirm = at(DAY, 0, 0, 54); // 15 Jul 00:54
    assert(
      timelyConfirm >= prevWindow.start && timelyConfirm < prevWindow.end,
      "fixture check: the timely confirm must fall INSIDE the previous day's window",
    );
    await makeSale(cashMethod.id, "cash-early", at(DAY, 0, 0, 30));
    await makeSale(gcashMethod.id, "gcash-early", at(DAY, 0, 0, 30));

    for (const table of ["cashDailyBalance", "gcashDailyBalance"] as const) {
      await (prisma[table] as typeof prisma.cashDailyBalance).update({
        where: { date: PREV_DAY },
        data: { confirmedAt: timelyConfirm },
      });
    }

    const cashTimely = await cashReconciliationService.getExpectedEndingBalance(balanceShape);
    const gcashTimely = await gcashReconciliationService.getExpectedEndingBalance(balanceShape);
    assert(
      cashTimely === expectedWithSale,
      `timely confirm (cash): the 00:30 sale must be EXCLUDED — expected ${expectedWithSale}, got ${cashTimely}`,
    );
    assert(
      gcashTimely === expectedWithSale,
      `timely confirm (gcash): the 00:30 sale must be EXCLUDED — expected ${expectedWithSale}, got ${gcashTimely}`,
    );
    console.log("PASS: a timely previous-day confirm still applies — the already-counted sale stays excluded (Aug 8 preserved).");

    // ============== 4. The twins agree ==============
    assert(cashNullCutoff === gcashNullCutoff, "cash and gcash disagreed on the null-cutoff case");
    assert(cashLate === gcashLate, "cash and gcash disagreed on the late-confirm case");
    assert(cashTimely === gcashTimely, "cash and gcash disagreed on the timely-confirm case");
    console.log("PASS: cash and gcash produce identical results on every fixture — the twins have not diverged.");

    console.log("\nPASS: cutoff window bounding proven against real rows, both ledgers.");
  } finally {
    await prisma.sale.deleteMany({ where: { shiftId: shift.id } });
    await prisma.shift.delete({ where: { id: shift.id } }).catch(() => undefined);
    await cleanUp();
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
