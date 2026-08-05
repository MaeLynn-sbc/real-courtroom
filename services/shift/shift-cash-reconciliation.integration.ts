/**
 * Shift cash reconciliation — Gate 1. Completes existing, half-built
 * functionality: Shift.varianceCents has existed in the schema since
 * v1.1 but was never computed (its own stale comment said "stays null
 * until a Sale model exists" — one has existed for a while).
 *
 * Proves, against real rows:
 *   1. getExpectedCashForShift = openingCash + CASH-only sales for that
 *      shift — a GCash sale on the same shift must NOT count.
 *   2. A closing count that doesn't match expected, with no note, is
 *      rejected — proven failing-first: the exact same attempt, only
 *      difference is a note, then succeeds.
 *   3. varianceCents and closingCashCents are both computed server-side
 *      from the submitted denomination breakdown, never trusted from a
 *      client total — there is no closingCashCents input to forge at
 *      all anymore (endShiftSchema has no such field), so this is
 *      structurally guaranteed, not just conventionally followed.
 *   4. A closing count that exactly matches expected requires no note
 *      and yields varianceCents === 0.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { sumCashDenominationBreakdown } from "../../lib/cash-denominations";
import { shiftService } from "./shift.service";
import { saleService } from "../sales/sale.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const TEST_USERNAME_PREFIX = "shift-recon-test-";

async function createEmployee(username: string): Promise<{ id: string; userId: string }> {
  const role = await prisma.role.findFirstOrThrow({ where: { name: "COURT_ATTENDANT" } });
  const user = await prisma.user.create({ data: { name: username, username, roleId: role.id } });
  return prisma.employee.create({
    data: { userId: user.id, employeeNumber: `${username}-num`, firstName: "Test", lastName: "ReconEmployee" },
  });
}

async function cleanUp(): Promise<void> {
  const users = await prisma.user.findMany({ where: { username: { startsWith: TEST_USERNAME_PREFIX } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const employeeIds = employees.map((e) => e.id);
  const shifts = await prisma.shift.findMany({ where: { employeeId: { in: employeeIds } }, select: { id: true } });
  const shiftIds = shifts.map((s) => s.id);
  await prisma.sale.deleteMany({ where: { shiftId: { in: shiftIds } } });
  await prisma.shift.deleteMany({ where: { id: { in: shiftIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main(): Promise<void> {
  await cleanUp();

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  try {
    // ============== 1. Expected cash = opening + CASH-only sales ==============
    const employeeA = await createEmployee(`${TEST_USERNAME_PREFIX}a-${Date.now()}`);
    const shiftA = await shiftService.startShift(employeeA.id, { openingCashCents: 500000, openingNotes: undefined }, owner.id);

    await saleService.createSale({
      category: "PRODUCT",
      amountCents: 200000, // ₱2,000 cash
      paymentMethodId: cashMethod.id,
      employeeId: employeeA.id,
      shiftId: shiftA.id,
      description: "Recon test cash sale",
    });
    await saleService.createSale({
      category: "PRODUCT",
      amountCents: 999900, // ₱9,999 GCash — must NOT count toward expected cash
      paymentMethodId: gcashMethod.id,
      employeeId: employeeA.id,
      shiftId: shiftA.id,
      description: "Recon test GCash sale — must NOT count as cash",
    });

    const expectedCashCents = await shiftService.getExpectedCashForShift(shiftA);
    console.log(`Expected cash: ${expectedCashCents} cents (opening ₱5,000 + cash sale ₱2,000; GCash ₱9,999 excluded)`);
    assert(expectedCashCents === 700000, `expected 700000 (500000 opening + 200000 cash sale), got ${expectedCashCents}`);
    console.log("PASS: expected cash is opening + CASH-only sales — the GCash sale on the same shift is correctly excluded.");

    // ============== 2. Mismatched count with no note — rejected, proven failing-first ==============
    // ₱6,800 counted (6x₱1000 + 1x₱500 + 1x₱200 + 1x₱100) against ₱7,000 expected — short by ₱200.
    const mismatchedBreakdown = { "1000": 6, "500": 1, "200": 1, "100": 1 };
    const mismatchedTotalCents = sumCashDenominationBreakdown(mismatchedBreakdown);
    assert(mismatchedTotalCents === 680000, `sanity check: expected 680000, got ${mismatchedTotalCents}`);

    let rejectedNoNote = false;
    try {
      await shiftService.endShift(shiftA.id, { closingCashBreakdown: mismatchedBreakdown, closingNotes: undefined }, owner.id);
    } catch (error) {
      rejectedNoNote = true;
      assert(error instanceof Error && error.message.toLowerCase().includes("expected"), `expected a variance-related error, got: ${error}`);
    }
    assert(rejectedNoNote, "expected a mismatched count with no note to be rejected");
    const shiftAfterFailedAttempt = await prisma.shift.findUniqueOrThrow({ where: { id: shiftA.id } });
    assert(shiftAfterFailedAttempt.status === "OPEN", `expected the shift to remain OPEN after a rejected close attempt, got ${shiftAfterFailedAttempt.status}`);
    console.log("PASS: a mismatched cash count with no note is rejected — proven failing-first — and the shift stays open.");

    // Same attempt, now with a note — succeeds.
    const closedWithVariance = await shiftService.endShift(
      shiftA.id,
      { closingCashBreakdown: mismatchedBreakdown, closingNotes: "Counted short — will investigate." },
      owner.id,
    );
    console.log(`Closed with variance: closingCashCents=${closedWithVariance.closingCashCents}, varianceCents=${closedWithVariance.varianceCents}`);
    assert(closedWithVariance.status === "CLOSED", `expected CLOSED, got ${closedWithVariance.status}`);
    assert(closedWithVariance.closingCashCents === 680000, `expected closingCashCents computed from the breakdown (680000), got ${closedWithVariance.closingCashCents}`);
    assert(closedWithVariance.varianceCents === -20000, `expected varianceCents -20000 (680000 - 700000), got ${closedWithVariance.varianceCents}`);
    assert(
      JSON.stringify(closedWithVariance.closingCashBreakdown) === JSON.stringify(mismatchedBreakdown),
      `expected the submitted breakdown persisted as the audit trail, got ${JSON.stringify(closedWithVariance.closingCashBreakdown)}`,
    );
    console.log("PASS: closing with a note succeeds — closingCashCents and varianceCents both computed server-side, breakdown persisted as the audit trail.");

    // ============== 3. Exact match — no note required, variance 0 ==============
    const employeeB = await createEmployee(`${TEST_USERNAME_PREFIX}b-${Date.now()}`);
    const shiftB = await shiftService.startShift(employeeB.id, { openingCashCents: 100000, openingNotes: undefined }, owner.id);
    await saleService.createSale({
      category: "PRODUCT",
      amountCents: 250000, // ₱2,500 cash
      paymentMethodId: cashMethod.id,
      employeeId: employeeB.id,
      shiftId: shiftB.id,
      description: "Recon test exact-match cash sale",
    });
    // Expected: 100000 + 250000 = 350000 cents = ₱3,500.
    const exactBreakdown = { "1000": 3, "200": 2, "100": 1 }; // 3000 + 400 + 100 = 3500
    const exactTotalCents = sumCashDenominationBreakdown(exactBreakdown);
    assert(exactTotalCents === 350000, `sanity check: expected 350000, got ${exactTotalCents}`);

    const closedExact = await shiftService.endShift(shiftB.id, { closingCashBreakdown: exactBreakdown, closingNotes: undefined }, owner.id);
    console.log(`Closed with exact match: closingCashCents=${closedExact.closingCashCents}, varianceCents=${closedExact.varianceCents}`);
    assert(closedExact.varianceCents === 0, `expected varianceCents 0, got ${closedExact.varianceCents}`);
    assert(closedExact.status === "CLOSED", `expected CLOSED, got ${closedExact.status}`);
    console.log("PASS: an exact-matching count needs no note and closes with varianceCents 0.");

    await cleanUp();
    console.log("\nPASS: shift cash reconciliation proven against real rows.");
  } catch (error) {
    await cleanUp();
    throw error;
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUp();
  process.exit(1);
});
