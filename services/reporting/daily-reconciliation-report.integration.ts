/**
 * Owner request (2026-09-22): "in the sales report. can we have like daily
 * sales if we pull up for a month range. like for example the whole momth
 * of august. include there the one in the daily sales. the total sales
 * from cash, gcash and the expenses and the total variance daily."
 *
 * The Daily sales & reconciliation report already emitted one row per day
 * for any range; what it never carried was the EXPENSES and a combined
 * variance. Proves, against real rows:
 *   1. One row per calendar day across a multi-day range, including days
 *      with nothing at all.
 *   2. Each day's cash/GCash expenses land on that day, split by payment
 *      method — the same figures the reconciliation services subtract.
 *   3. Total variance = cash + GCash for the day, and stays NULL when no
 *      till was confirmed (so an unopened day never reads as balanced).
 *   4. A day with only ONE till confirmed reports that till's variance,
 *      not a silent zero for the other.
 *   5. Deposited (cash banked at close) reports what was withdrawn, 0
 *      when a closed till banked nothing, and null when nobody closed
 *      up at all.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { reportingService } from "./reporting.service";

const MARKER = `daily-recon-report-${Date.now()}`;
// A quiet stretch no other fixture uses. Literal local midnight, matching
// how Expense.date and the daily-balance rows are stored.
const DAY_ONE = new Date(2031, 7, 10);
const DAY_TWO = new Date(2031, 7, 11);
const DAY_THREE = new Date(2031, 7, 12);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  await prisma.sale.deleteMany({ where: { saleNumber: { startsWith: MARKER } } });
  await prisma.expense.deleteMany({ where: { expenseNumber: { startsWith: MARKER } } });
  for (const date of [DAY_ONE, DAY_TWO, DAY_THREE]) {
    await prisma.cashDailyBalance.deleteMany({ where: { date } });
    await prisma.gcashDailyBalance.deleteMany({ where: { date } });
  }
  await prisma.shift.deleteMany({ where: { shiftNumber: { startsWith: MARKER } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });
  const expenseCategory = await prisma.expenseCategory.findFirstOrThrow();

  await cleanUp();
  const shift = await prisma.shift.create({
    data: { shiftNumber: `${MARKER}-shift`, employeeId: employee.id, status: "OPEN" },
  });

  try {
    // Day two carries everything: sales both ways, expenses both ways,
    // and both tills confirmed with a variance each.
    await prisma.sale.createMany({
      data: [
        {
          saleNumber: `${MARKER}-cash`,
          category: "BOOKING",
          amountCents: 70000,
          paymentMethodId: cashMethod.id,
          employeeId: employee.id,
          shiftId: shift.id,
          businessDate: DAY_TWO,
        },
        {
          saleNumber: `${MARKER}-gcash`,
          category: "BOOKING",
          amountCents: 35000,
          paymentMethodId: gcashMethod.id,
          employeeId: employee.id,
          shiftId: shift.id,
          businessDate: DAY_TWO,
        },
      ],
    });
    await prisma.expense.createMany({
      data: [
        {
          expenseNumber: `${MARKER}-cash-exp`,
          amountCents: 12600,
          date: DAY_TWO,
          description: "Garbage bags",
          categoryId: expenseCategory.id,
          paymentMethodId: cashMethod.id,
          recordedByEmployeeId: employee.id,
        },
        {
          expenseNumber: `${MARKER}-gcash-exp`,
          amountCents: 400000,
          date: DAY_TWO,
          description: "Coach payout",
          categoryId: expenseCategory.id,
          paymentMethodId: gcashMethod.id,
          recordedByEmployeeId: employee.id,
        },
      ],
    });
    await prisma.cashDailyBalance.create({
      data: {
        date: DAY_TWO,
        startingBalanceCents: 100000,
        expectedEndingBalanceCents: 157400,
        confirmedEndingBalanceCents: 147400,
        varianceCents: -10000,
        withdrawnCents: 100000,
        status: "CONFIRMED",
        confirmedAt: DAY_TWO,
        notes: MARKER,
      },
    });
    await prisma.gcashDailyBalance.create({
      data: {
        date: DAY_TWO,
        startingBalanceCents: 500000,
        expectedEndingBalanceCents: 135000,
        confirmedEndingBalanceCents: 138500,
        varianceCents: 3500,
        status: "CONFIRMED",
        confirmedAt: DAY_TWO,
        notes: MARKER,
      },
    });
    // Day three: only the cash till was confirmed.
    await prisma.cashDailyBalance.create({
      data: {
        date: DAY_THREE,
        startingBalanceCents: 147400,
        expectedEndingBalanceCents: 147400,
        confirmedEndingBalanceCents: 147300,
        varianceCents: -100,
        withdrawnCents: 0,
        status: "CONFIRMED",
        confirmedAt: DAY_THREE,
        notes: MARKER,
      },
    });

    const rows = await reportingService.getDailyReconciliationReport(
      { from: DAY_ONE, to: DAY_THREE },
      0,
    );

    // ============== 1. One row per day, quiet days included ==============
    assert(rows.length === 3, `expected one row per day, got ${rows.length}`);
    const [dayOne, dayTwo, dayThree] = rows;
    assert(
      dayOne.date.getTime() === DAY_ONE.getTime() && dayThree.date.getTime() === DAY_THREE.getTime(),
      "rows run in date order across the whole range",
    );
    console.log(`PASS: a ${rows.length}-day range returns ${rows.length} daily rows.`);

    // ============== 2. Expenses, split by payment method ==============
    assert(
      dayTwo.cashSalesCents === 70000 && dayTwo.gcashSalesCents === 35000,
      `day two sales, got cash ${dayTwo.cashSalesCents} / gcash ${dayTwo.gcashSalesCents}`,
    );
    assert(dayTwo.totalSalesCents === 105000, `day two total sales, got ${dayTwo.totalSalesCents}`);
    assert(
      dayTwo.cashExpensesCents === 12600 && dayTwo.gcashExpensesCents === 400000,
      `day two expenses, got cash ${dayTwo.cashExpensesCents} / gcash ${dayTwo.gcashExpensesCents}`,
    );
    assert(
      dayTwo.totalExpensesCents === 412600,
      `day two total expenses, got ${dayTwo.totalExpensesCents}`,
    );
    assert(
      dayOne.cashExpensesCents === 0 && dayOne.totalExpensesCents === 0,
      "a day with no expenses reports zero, not null",
    );
    console.log(
      `PASS: expenses land per day and per method — day two ₱${dayTwo.totalExpensesCents / 100}.`,
    );

    // ============== 3. Total variance ==============
    assert(
      dayTwo.cashVarianceCents === -10000 && dayTwo.gcashVarianceCents === 3500,
      "day two keeps each till's own confirmed variance",
    );
    assert(
      dayTwo.totalVarianceCents === -6500,
      `day two total variance should be -6500, got ${dayTwo.totalVarianceCents}`,
    );
    assert(
      dayOne.totalVarianceCents === null,
      `an unconfirmed day's total variance must stay null, got ${dayOne.totalVarianceCents}`,
    );
    console.log("PASS: total variance adds the two tills and stays null when neither was closed.");

    // ============== 4. Only one till confirmed ==============
    assert(
      dayThree.gcashVarianceCents === null && dayThree.totalVarianceCents === -100,
      `day three should report the cash till alone, got ${dayThree.totalVarianceCents}`,
    );
    console.log("PASS: a day with one till closed reports that till, not a silent zero.");

    // ============== 5. Deposited (owner request, 2026-09-22) ==============
    assert(
      dayTwo.cashDepositedCents === 100000,
      `day two banked P1,000, got ${dayTwo.cashDepositedCents}`,
    );
    assert(
      dayThree.cashDepositedCents === 0,
      "a closed till that banked nothing reports 0, not null",
    );
    assert(
      dayOne.cashDepositedCents === null,
      `an unopened till reports null deposited, not 0, got ${dayOne.cashDepositedCents}`,
    );
    console.log("PASS: deposited reports what was banked, and stays null when nobody closed up.");
  } finally {
    await cleanUp();
  }

  console.log("PASS: daily sales & reconciliation report proven for a multi-day range.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
