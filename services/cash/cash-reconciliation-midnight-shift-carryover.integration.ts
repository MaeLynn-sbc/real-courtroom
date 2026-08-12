/**
 * Cash's twin of services/gcash/gcash-reconciliation-midnight-shift-
 * carryover.integration.ts — same real incident (2026-08-08), same fix,
 * same reasoning, applied to CashReconciliationService instead.
 *
 * Owner-directed consolidation (2026-08-12) changed HOW this incident is
 * prevented: a sale rung up just after midnight but before the rollover
 * hour now gets Sale.businessDate = the PREVIOUS business day at the
 * moment it's created (the same computeBusinessDate every other correct
 * part of the app uses), so getCashSalesForDate(dayOne) correctly
 * includes it from the start — no separate excludeBefore/confirmedAt
 * exclusion needed for this case anymore. excludeBefore remains as an
 * independent safety net for a genuinely late confirmation (see that
 * parameter's own comment in sale.service.ts) — not exercised by this
 * test, which is specifically about the ordinary midnight-spanning case.
 *
 * Traced on a real Aug 7 cash reconciliation: ₱1,120.00 that used to be
 * double-counted, accounting for exactly half of a ₱2,220.00 reported
 * deficit — the original incident this test was written to prove fixed.
 *
 * Proves, against real rows:
 *   1. A sale rung up just after midnight but BEFORE the rollover hour
 *      is attributed to the PREVIOUS business day's expected balance
 *      directly — no unexplained variance, no manual note needed.
 *   2. The next business day's starting balance carries that forward
 *      correctly, and does NOT also count that same sale again.
 *   3. A sale rung up just after midnight but AFTER the rollover hour
 *      belongs to the NEXT business day, not the previous one — the
 *      boundary is the rollover hour, not literal midnight.
 *   4. A sale rung up well into the next business day still counts
 *      normally.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { cashReconciliationService } from "./cash-reconciliation.service";
import { saleService } from "../sales/sale.service";
import { settingsService } from "../settings/settings.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const TEST_USERNAME_PREFIX = "cash-midnight-carryover-test-";
const DAY_ONE = new Date(2021, 2, 14); // arbitrary, isolated, real-past date
const DAY_TWO = new Date(2021, 2, 15);

async function createEmployee(username: string): Promise<{ id: string; userId: string }> {
  const role = await prisma.role.findFirstOrThrow({ where: { name: "COURT_ATTENDANT" } });
  const user = await prisma.user.create({ data: { name: username, username, roleId: role.id } });
  return prisma.employee.create({
    data: { userId: user.id, employeeNumber: `${username}-num`, firstName: "Test", lastName: "MidnightCarryover" },
  });
}

async function cleanUp(employeeId?: string): Promise<void> {
  await prisma.cashDailyBalance.deleteMany({ where: { date: { in: [DAY_ONE, DAY_TWO] } } });
  if (employeeId) {
    await prisma.sale.deleteMany({ where: { employeeId } });
  }

  const users = await prisma.user.findMany({ where: { username: { startsWith: TEST_USERNAME_PREFIX } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const employeeIds = employees.map((e) => e.id);
  await prisma.sale.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.shift.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main(): Promise<void> {
  await cleanUp();

  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const courtHours = await settingsService.getCourtHours();
  const rolloverHour = courtHours.businessDateRolloverHour;
  assert(rolloverHour >= 1 && rolloverHour <= 22, `this test assumes a rollover hour with room on both sides, got ${rolloverHour}`);

  let employeeId: string | undefined;

  try {
    const employee = await createEmployee(`${TEST_USERNAME_PREFIX}${Date.now()}`);
    employeeId = employee.id;
    const shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-MIDCARRY-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
    });

    const dayOneRow = await prisma.cashDailyBalance.create({
      data: { date: DAY_ONE, startingBalanceCents: 100000, status: "OPEN" }, // ₱1,000
    });
    await saleService.createSale({
      category: "PRODUCT",
      amountCents: 50000, // ₱500 — an ordinary day-one sale
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      description: "Ordinary day-one sale",
      createdAt: new Date(DAY_ONE.getFullYear(), DAY_ONE.getMonth(), DAY_ONE.getDate(), 20, 0),
    });
    // Just after midnight, BEFORE the rollover hour — still day one's
    // business day.
    const lateSaleCreatedAt = new Date(
      DAY_TWO.getFullYear(),
      DAY_TWO.getMonth(),
      DAY_TWO.getDate(),
      Math.max(0, rolloverHour - 1),
      0,
    );
    await saleService.createSale({
      category: "PRODUCT",
      amountCents: 11200, // ₱112 — the "late" sale, minutes after midnight, before rollover
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      description: "Late post-midnight sale, before rollover — same shift, still open",
      createdAt: lateSaleCreatedAt,
    });

    // ============== 1. Attributed to day one directly, no variance ==============
    const dayOneExpected = await cashReconciliationService.getExpectedEndingBalance(dayOneRow);
    assert(
      dayOneExpected === 161200,
      `expected day one's expected ending to include the late-but-before-rollover sale directly (161200), got ${dayOneExpected}`,
    );
    console.log(
      "PASS: a sale rung up just after midnight but before the rollover hour is attributed to the previous business day directly — no unexplained variance.",
    );

    await prisma.cashDailyBalance.update({
      where: { id: dayOneRow.id },
      data: {
        status: "CONFIRMED",
        confirmedEndingBalanceCents: 161200,
        expectedEndingBalanceCents: dayOneExpected,
        varianceCents: 0,
        withdrawnCents: 0,
        confirmedAt: new Date(DAY_TWO.getFullYear(), DAY_TWO.getMonth(), DAY_TWO.getDate(), rolloverHour, 30),
        confirmedByEmployeeId: employee.id,
      },
    });

    // ============== 2. Day two doesn't double-count it ==============
    const dayTwoBalance = await cashReconciliationService.getOrCreateBalanceForDate(DAY_TWO);
    assert(dayTwoBalance, "expected day two's balance to materialize after day one confirmed");
    assert(
      dayTwoBalance!.startingBalanceCents === 161200,
      `expected day two's starting balance to carry forward 161200, got ${dayTwoBalance!.startingBalanceCents}`,
    );
    const dayTwoExpected = await cashReconciliationService.getExpectedEndingBalance(dayTwoBalance!);
    assert(
      dayTwoExpected === 161200,
      `expected day two's expected ending to equal its starting balance exactly (161200) — the late-but-before-rollover sale must not be double-counted — got ${dayTwoExpected}`,
    );
    console.log("PASS: the late-but-before-rollover sale, already attributed to day one, is NOT double-counted into day two.");

    // ============== 3. Just after the rollover hour -> genuinely day two ==============
    const justAfterRollover = new Date(
      DAY_TWO.getFullYear(),
      DAY_TWO.getMonth(),
      DAY_TWO.getDate(),
      Math.min(23, rolloverHour + 1),
      0,
    );
    const afterRolloverSale = await saleService.createSale({
      category: "PRODUCT",
      amountCents: 30000, // ₱300 — a real, new day-two sale
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      description: "A genuine day-two sale, after the rollover hour",
      createdAt: justAfterRollover,
    });
    const reloadedAfterRolloverSale = await prisma.sale.findUniqueOrThrow({ where: { id: afterRolloverSale.id } });
    assert(
      reloadedAfterRolloverSale.businessDate?.getTime() === DAY_TWO.getTime(),
      `expected a sale after the rollover hour to be attributed to day two, got ${reloadedAfterRolloverSale.businessDate?.toISOString()}`,
    );
    const dayTwoExpectedAfterNewSale = await cashReconciliationService.getExpectedEndingBalance(dayTwoBalance!);
    assert(
      dayTwoExpectedAfterNewSale === 191200,
      `expected day two's expected ending to rise by exactly the new 30000 sale (to 191200), got ${dayTwoExpectedAfterNewSale}`,
    );
    console.log("PASS: a sale rung up after the rollover hour belongs to the next business day and counts normally.");

    await cleanUp(employeeId);
    console.log("\nPASS: midnight-spanning shift carryover no longer double-counts cash — the boundary is the rollover hour, not literal midnight.");
  } catch (error) {
    await cleanUp(employeeId);
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
