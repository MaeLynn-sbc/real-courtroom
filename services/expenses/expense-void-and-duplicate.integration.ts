/**
 * Owner-reported incident (2026-09-21, reported 2026-09-22): "yesterday, i
 * was the once who did the coach pay out for 8200. maybe the internet is
 * slow. it was done twice." Two identical PHP 8,200 GCash coach payouts
 * were recorded 15 seconds apart. The money left GCash once. Nothing
 * warned, and nothing in the app could take the duplicate off the books —
 * there was no delete or void for an expense at all.
 *
 * Proves, against real rows:
 *   1. findRecentDuplicate spots a second identical expense inside the
 *      window, and the real pair's 15-second gap is caught.
 *   2. It does NOT flag a different amount, a different day, a different
 *      payment method, or one outside the window — the venue really does
 *      pay two coaches on the same evening.
 *   3. A voided expense stops counting in the day's GCash expenses, the
 *      range total, and the sales report's per-day expenses.
 *   4. The row survives with its reason and author; voiding twice is
 *      refused; a reason is required.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { reportingService } from "../reporting/reporting.service";
import { expenseService } from "./expense.service";

const MARKER = `expense-void-test-${Date.now()}`;
const TEST_DATE = new Date(2031, 9, 14);
const OTHER_DATE = new Date(2031, 9, 15);
const AMOUNT = 820000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  await prisma.expense.deleteMany({ where: { description: { startsWith: MARKER } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const gcash = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });
  const cash = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const category = await prisma.expenseCategory.findFirstOrThrow();
  const otherCategory =
    (await prisma.expenseCategory.findFirst({ where: { id: { not: category.id } } })) ?? category;

  await cleanUp();

  try {
    const base = {
      amountCents: AMOUNT,
      date: TEST_DATE,
      categoryId: category.id,
      paymentMethodId: gcash.id,
      recordedByEmployeeId: employee.id,
    };

    // ============== 1. The real pair ==============
    assert(
      (await expenseService.findRecentDuplicate(base)) === null,
      "nothing on file yet, so the first payout must not be flagged",
    );
    const first = await expenseService.createExpense(
      { ...base, description: `${MARKER} Coach payout — Dhudz, week of Sep 13 – Sep 19` },
      owner.id,
    );
    const found = await expenseService.findRecentDuplicate(base);
    assert(found?.id === first.id, "the second identical payout must find the first");
    console.log(`PASS: a second identical payout finds the first — ₱${AMOUNT / 100} already on file.`);

    // The reported gap was 15 seconds; check the window from the far end
    // too, so a short window can't silently stop catching this.
    assert(
      (await expenseService.findRecentDuplicate(
        base,
        15_000,
        new Date(first.createdAt.getTime() + 15_000),
      ))?.id === first.id,
      "the real 15-second gap is inside the window",
    );
    assert(
      (await expenseService.findRecentDuplicate(
        base,
        30 * 60 * 1000,
        new Date(first.createdAt.getTime() + 31 * 60 * 1000),
      )) === null,
      "an expense older than the window is not flagged",
    );

    // ============== 2. Genuinely different outflows are not flagged ==============
    assert(
      (await expenseService.findRecentDuplicate({ ...base, amountCents: AMOUNT + 100 })) === null,
      "a different amount is not a duplicate",
    );
    assert(
      (await expenseService.findRecentDuplicate({ ...base, date: OTHER_DATE })) === null,
      "the same amount on a different day is not a duplicate",
    );
    assert(
      (await expenseService.findRecentDuplicate({ ...base, paymentMethodId: cash.id })) === null,
      "the same amount from a different till is not a duplicate",
    );
    if (otherCategory.id !== category.id) {
      assert(
        (await expenseService.findRecentDuplicate({ ...base, categoryId: otherCategory.id })) ===
          null,
        "the same amount in a different category is not a duplicate",
      );
    }
    console.log("PASS: a different amount, day, till or category is never flagged as a duplicate.");

    // ============== 3. Voiding takes it off every total ==============
    const duplicate = await expenseService.createExpense(
      { ...base, description: `${MARKER} Coach payout — Dhudz, DUPLICATE` },
      owner.id,
    );
    const range = { from: TEST_DATE, to: TEST_DATE };
    const beforeDay = await expenseService.getGcashExpensesForDate(TEST_DATE);
    const beforeRange = await expenseService.getExpensesTotalForRange(range);
    assert(
      beforeDay === AMOUNT * 2,
      `both payouts count before the reversal, got ${beforeDay}`,
    );

    let noReason = false;
    try {
      await expenseService.voidExpense(duplicate.id, "   ", employee.id, owner.id);
    } catch {
      noReason = true;
    }
    assert(noReason, "a reversal with no reason must be refused");

    await expenseService.voidExpense(
      duplicate.id,
      "Recorded twice — slow connection, double submit",
      employee.id,
      owner.id,
    );

    const afterDay = await expenseService.getGcashExpensesForDate(TEST_DATE);
    const afterRange = await expenseService.getExpensesTotalForRange(range);
    assert(
      afterDay === beforeDay - AMOUNT,
      `the day's GCash expenses must drop by exactly ₱${AMOUNT / 100}, got ${afterDay}`,
    );
    assert(
      afterRange === beforeRange - AMOUNT,
      `the range total must drop by exactly ₱${AMOUNT / 100}, got ${afterRange}`,
    );

    const reportRows = await reportingService.getDailyReconciliationReport(range, 0);
    assert(
      reportRows[0]?.gcashExpensesCents === AMOUNT,
      `the sales report must show one payout, not two, got ${reportRows[0]?.gcashExpensesCents}`,
    );
    console.log(
      `PASS: a reversed payout leaves the day's expenses, the range total and the sales report — ₱${afterDay / 100} stands.`,
    );

    // ============== 4. The record survives, and can't be voided twice ==============
    const stored = await prisma.expense.findUniqueOrThrow({
      where: { id: duplicate.id },
      include: { voidedByEmployee: { select: { firstName: true } } },
    });
    assert(
      stored.voidedAt !== null &&
        stored.voidReason === "Recorded twice — slow connection, double submit" &&
        stored.voidedByEmployeeId === employee.id,
      "the reversal records when, why and who",
    );
    assert(
      stored.amountCents === AMOUNT && stored.expenseNumber.length > 0,
      "the row itself is kept, not deleted",
    );

    let secondVoid = false;
    try {
      await expenseService.voidExpense(duplicate.id, "again", employee.id, owner.id);
    } catch {
      secondVoid = true;
    }
    assert(secondVoid, "voiding the same expense twice must be refused");

    // And a voided expense is never offered as a duplicate match, so the
    // reversal doesn't block re-recording the payout correctly.
    const afterVoidMatch = await expenseService.findRecentDuplicate(base);
    assert(
      afterVoidMatch?.id === first.id,
      "the surviving payout is still the duplicate match, the voided one is not",
    );
    console.log("PASS: the reversed row is kept with its reason and author, and can't be voided twice.");
  } finally {
    await cleanUp();
  }

  console.log("PASS: duplicate expenses are caught, and a mistaken one can be reversed.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUp().catch(() => {});
  process.exit(1);
});
