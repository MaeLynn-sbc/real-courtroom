/**
 * GCash's twin of services/cash/cash-reconciliation-midnight-shift-
 * carryover.integration.ts — same real incident (2026-08-08), same fix,
 * same reasoning, applied to GcashReconciliationService instead. See
 * that file's own comment for the full incident writeup.
 *
 * Proves, against real rows:
 *   1. A sale whose createdAt is BEFORE the previous day's confirmedAt
 *      is excluded from the day's expected ending balance.
 *   2. A sale whose createdAt is AFTER the previous day's confirmedAt
 *      still counts normally.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { gcashReconciliationService } from "./gcash-reconciliation.service";
import { saleService } from "../sales/sale.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const TEST_USERNAME_PREFIX = "gcash-midnight-carryover-test-";
const DAY_ONE = new Date(2021, 2, 14);
const DAY_TWO = new Date(2021, 2, 15);

async function createEmployee(username: string): Promise<{ id: string; userId: string }> {
  const role = await prisma.role.findFirstOrThrow({ where: { name: "COURT_ATTENDANT" } });
  const user = await prisma.user.create({ data: { name: username, username, roleId: role.id } });
  return prisma.employee.create({
    data: { userId: user.id, employeeNumber: `${username}-num`, firstName: "Test", lastName: "MidnightCarryover" },
  });
}

async function cleanUp(employeeId?: string): Promise<void> {
  await prisma.gcashDailyBalance.deleteMany({ where: { date: { in: [DAY_ONE, DAY_TWO] } } });
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

  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  let employeeId: string | undefined;

  try {
    const employee = await createEmployee(`${TEST_USERNAME_PREFIX}${Date.now()}`);
    employeeId = employee.id;
    const shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-GMIDCARRY-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
    });

    const dayOneRow = await prisma.gcashDailyBalance.create({
      data: { date: DAY_ONE, startingBalanceCents: 100000, status: "OPEN" },
    });
    await saleService.createSale({
      category: "PRODUCT",
      amountCents: 50000,
      paymentMethodId: gcashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      description: "Ordinary day-one sale",
      createdAt: new Date(DAY_ONE.getFullYear(), DAY_ONE.getMonth(), DAY_ONE.getDate(), 20, 0),
    });
    const lateSaleCreatedAt = new Date(DAY_TWO.getFullYear(), DAY_TWO.getMonth(), DAY_TWO.getDate(), 0, 5);
    await saleService.createSale({
      category: "PRODUCT",
      amountCents: 11200,
      paymentMethodId: gcashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      description: "Late post-midnight sale — same shift, still open",
      createdAt: lateSaleCreatedAt,
    });

    const dayOneExpected = await gcashReconciliationService.getExpectedEndingBalance(dayOneRow);
    assert(dayOneExpected === 150000, `expected day one's expected ending to be 150000, got ${dayOneExpected}`);

    const confirmedAt = new Date(DAY_TWO.getFullYear(), DAY_TWO.getMonth(), DAY_TWO.getDate(), 0, 30);
    await prisma.gcashDailyBalance.update({
      where: { id: dayOneRow.id },
      data: {
        status: "CONFIRMED",
        confirmedEndingBalanceCents: 161200,
        expectedEndingBalanceCents: dayOneExpected,
        varianceCents: 161200 - dayOneExpected,
        confirmedAt,
        confirmedByEmployeeId: employee.id,
        notes: "Physical count includes a sale rung up just after midnight.",
      },
    });
    console.log("PASS: day one confirmed with the late sale physically included in the count.");

    const dayTwoBalance = await gcashReconciliationService.getOrCreateBalanceForDate(DAY_TWO);
    assert(dayTwoBalance, "expected day two's balance to materialize after day one confirmed");
    assert(
      dayTwoBalance!.startingBalanceCents === 161200,
      `expected day two's starting balance to carry forward 161200, got ${dayTwoBalance!.startingBalanceCents}`,
    );
    const dayTwoExpected = await gcashReconciliationService.getExpectedEndingBalance(dayTwoBalance!);
    assert(
      dayTwoExpected === 161200,
      `expected day two's expected ending to equal its starting balance exactly (161200) — the late sale must be excluded — got ${dayTwoExpected}`,
    );
    console.log("PASS: the late sale, already captured in day one's confirm, is NOT double-counted into day two's expected balance.");

    await saleService.createSale({
      category: "PRODUCT",
      amountCents: 30000,
      paymentMethodId: gcashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      description: "A genuine day-two sale",
      createdAt: new Date(DAY_TWO.getFullYear(), DAY_TWO.getMonth(), DAY_TWO.getDate(), 10, 0),
    });
    const dayTwoExpectedAfterNewSale = await gcashReconciliationService.getExpectedEndingBalance(dayTwoBalance!);
    assert(
      dayTwoExpectedAfterNewSale === 191200,
      `expected day two's expected ending to rise by exactly the new 30000 sale (to 191200), got ${dayTwoExpectedAfterNewSale}`,
    );
    console.log("PASS: a genuinely new day-two sale, after day one's confirmedAt, still counts normally.");

    await cleanUp(employeeId);
    console.log("\nPASS: midnight-spanning shift carryover no longer double-counts GCash either, proven against real rows.");
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
