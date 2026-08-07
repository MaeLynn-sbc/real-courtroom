/**
 * Real incident (2026-08-08): a shift spanning midnight had its physical
 * closing count confirmed as the PREVIOUS day's ending balance, several
 * minutes AFTER a few more sales had already come in right after
 * midnight. That confirmed figure already included those sales (the
 * physical drawer count happened after them). The following day's own
 * expected-balance calculation then counted the SAME sales a second
 * time, purely because their createdAt fell after midnight — inflating
 * that day's expected total, and its reported deficit, by real money
 * that was never actually going to reappear in that day's drawer.
 * Traced on a real Aug 7 cash reconciliation: ₱1,120.00 double-counted,
 * accounting for exactly half of a ₱2,220.00 reported deficit.
 *
 * Proves, against real rows:
 *   1. A sale whose createdAt is BEFORE the previous day's confirmedAt
 *      is excluded from the day's expected ending balance — it was
 *      already captured in that earlier physical count.
 *   2. A sale whose createdAt is AFTER the previous day's confirmedAt
 *      still counts normally — this fix only excludes what was already
 *      captured, nothing else.
 *
 * Uses fixed, far-past isolated dates (safely outside any real business
 * date this app has ever operated on), with confirmedAt set directly via
 * Prisma rather than through confirmBalance() (which always stamps real
 * wall-clock "now") — the whole point of this test is the RELATIONSHIP
 * between a sale's createdAt and the previous day's confirmedAt, so both
 * need to be under this test's own control, not tied to whenever it
 * happens to run. Never collides with the sequential today/tomorrow
 * narrative the main cash-reconciliation.integration.ts suite owns.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { cashReconciliationService } from "./cash-reconciliation.service";
import { saleService } from "../sales/sale.service";

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

  let employeeId: string | undefined;

  try {
    const employee = await createEmployee(`${TEST_USERNAME_PREFIX}${Date.now()}`);
    employeeId = employee.id;
    const shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-MIDCARRY-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
    });

    // ============== Setup: day one, an ordinary sale, then a "late" sale just after midnight ==============
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
    const lateSaleCreatedAt = new Date(DAY_TWO.getFullYear(), DAY_TWO.getMonth(), DAY_TWO.getDate(), 0, 5);
    await saleService.createSale({
      category: "PRODUCT",
      amountCents: 11200, // ₱112 — the "late" sale, minutes after midnight, day-two's calendar date
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      description: "Late post-midnight sale — same shift, still open",
      createdAt: lateSaleCreatedAt,
    });

    // Day one's OWN expected total never includes the late sale at all —
    // its createdAt is on day two, outside day one's own [dayOne, dayTwo)
    // window. Confirms the fixture: day one's expected is exactly the
    // ₱500 ordinary sale.
    const dayOneExpected = await cashReconciliationService.getExpectedEndingBalance(dayOneRow);
    assert(dayOneExpected === 150000, `expected day one's expected ending to be 150000 (starting 100000 + 50000 sale), got ${dayOneExpected}`);

    // Confirmed at day-two 00:30 — 25 minutes AFTER the late sale
    // (00:05). This is the physical count that (in the real incident)
    // happened after the post-midnight sale, so it already captured
    // that ₱112 in its ₱1,612 confirmed drawer count. Set directly, not
    // via confirmBalance() (which always stamps real wall-clock "now")
    // — this test needs confirmedAt fully under its own control, not
    // tied to whenever it happens to run.
    const confirmedAt = new Date(DAY_TWO.getFullYear(), DAY_TWO.getMonth(), DAY_TWO.getDate(), 0, 30);
    await prisma.cashDailyBalance.update({
      where: { id: dayOneRow.id },
      data: {
        status: "CONFIRMED",
        confirmedEndingBalanceCents: 161200, // starting 1000 + ordinary 500 + the late 112, physically counted together
        expectedEndingBalanceCents: dayOneExpected,
        varianceCents: 161200 - dayOneExpected,
        withdrawnCents: 0,
        confirmedAt,
        confirmedByEmployeeId: employee.id,
        notes: "Physical count includes a sale rung up just after midnight.",
      },
    });
    console.log("PASS: day one confirmed with the late sale's cash physically included in the count.");

    // ============== 1. Day two's expected total must NOT double-count the late sale ==============
    const dayTwoBalance = await cashReconciliationService.getOrCreateBalanceForDate(DAY_TWO);
    assert(dayTwoBalance, "expected day two's balance to materialize after day one confirmed");
    assert(
      dayTwoBalance!.startingBalanceCents === 161200,
      `expected day two's starting balance to carry forward the full 161200 (nothing withdrawn), got ${dayTwoBalance!.startingBalanceCents}`,
    );
    const dayTwoExpected = await cashReconciliationService.getExpectedEndingBalance(dayTwoBalance!);
    assert(
      dayTwoExpected === 161200,
      `expected day two's expected ending to equal its starting balance exactly (161200) — the late sale must be excluded, not summed again — got ${dayTwoExpected}`,
    );
    console.log("PASS: the late sale, already captured in day one's physical count, is NOT double-counted into day two's expected balance.");

    // ============== 2. A genuinely NEW day-two sale, created AFTER day one's confirmedAt, still counts normally ==============
    await saleService.createSale({
      category: "PRODUCT",
      amountCents: 30000, // ₱300 — a real, new day-two sale, well after confirmedAt (00:30)
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      description: "A genuine day-two sale",
      createdAt: new Date(DAY_TWO.getFullYear(), DAY_TWO.getMonth(), DAY_TWO.getDate(), 10, 0),
    });
    const dayTwoExpectedAfterNewSale = await cashReconciliationService.getExpectedEndingBalance(dayTwoBalance!);
    assert(
      dayTwoExpectedAfterNewSale === 191200,
      `expected day two's expected ending to rise by exactly the new 30000 sale (to 191200), got ${dayTwoExpectedAfterNewSale}`,
    );
    console.log("PASS: a genuinely new day-two sale, after day one's confirmedAt, still counts normally — this fix only excludes what was already captured.");

    await cleanUp(employeeId);
    console.log("\nPASS: midnight-spanning shift carryover no longer double-counts, proven against real rows.");
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
