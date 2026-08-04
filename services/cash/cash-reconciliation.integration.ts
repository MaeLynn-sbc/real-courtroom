/**
 * Cash reconciliation — cash's twin of GCash reconciliation
 * (services/gcash/gcash-reconciliation.integration.ts), same discipline,
 * date-scoped (one shared running float for the whole business) rather
 * than shift-scoped — separate from and unaffected by Shift's own
 * per-drawer opening/closing cash reconciliation.
 *
 * Proves, against real rows:
 *   1. No prior CONFIRMED day -> getOrCreateBalanceForDate returns
 *      null, not a crash — the "needs seed" state is a real, handled
 *      case.
 *   2. seedFirstBalance creates today's record; a second seed attempt
 *      is rejected (one-time only).
 *   3. Expected ending balance moves by exactly a known Cash sale's
 *      amount.
 *   4. A mismatched confirmation with no note is rejected — proven
 *      failing-first: the exact same attempt, only difference is a
 *      note, then succeeds, with the correct variance persisted.
 *   5. Carry-forward: confirming today auto-creates tomorrow's record
 *      with startingBalanceCents equal to today's confirmed ending
 *      balance MINUS whatever was withdrawn for the bank/safe — only
 *      the drawer leftover carries forward, never re-entered manually.
 *   6. overrideStartingBalance requires a reason, writes an audit-log
 *      entry with the old and new value, and is refused once the day
 *      is already CONFIRMED.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import {
  cashReconciliationService,
  CashBalanceAlreadyConfirmedError,
} from "./cash-reconciliation.service";
import { saleService } from "../sales/sale.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const TEST_USERNAME_PREFIX = "cash-recon-test-";

function toMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

async function createEmployee(username: string): Promise<{ id: string; userId: string }> {
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });
  const user = await prisma.user.create({ data: { name: username, username, roleId: role.id } });
  return prisma.employee.create({
    data: {
      userId: user.id,
      employeeNumber: `${username}-num`,
      firstName: "Test",
      lastName: "CashRecon",
    },
  });
}

async function cleanUp(employeeId?: string): Promise<void> {
  const today = toMidnight(new Date());
  await prisma.cashDailyBalance.deleteMany({ where: { date: { gte: today } } });

  if (employeeId) {
    await prisma.sale.deleteMany({ where: { employeeId } });
  }

  const users = await prisma.user.findMany({
    where: { username: { startsWith: TEST_USERNAME_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const employeeIds = employees.map((e) => e.id);
  await prisma.sale.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.shift.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main(): Promise<void> {
  await cleanUp();

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

  const today = toMidnight(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let employeeId: string | undefined;

  try {
    const employee = await createEmployee(`${TEST_USERNAME_PREFIX}${Date.now()}`);
    employeeId = employee.id;
    const shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-CASH-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
    });

    // ============== 1. No prior CONFIRMED day -> null, not a crash ==============
    const noDay = await cashReconciliationService.getOrCreateBalanceForDate(today);
    assert(
      noDay === null,
      `expected null with no prior CONFIRMED day, got ${JSON.stringify(noDay)}`,
    );
    console.log(
      "PASS: with no prior CONFIRMED day, getOrCreateBalanceForDate returns null — a real handled case, not a crash.",
    );

    // ============== 2. One-time seed; a second attempt is rejected ==============
    const seeded = await cashReconciliationService.seedFirstBalance(500000, owner.id); // ₱5,000
    assert(seeded.date.getTime() === today.getTime(), "expected the seed to target today");
    assert(
      seeded.startingBalanceCents === 500000,
      `expected startingBalanceCents 500000, got ${seeded.startingBalanceCents}`,
    );
    assert(seeded.status === "OPEN", `expected OPEN, got ${seeded.status}`);

    let secondSeedRejected = false;
    try {
      await cashReconciliationService.seedFirstBalance(999999, owner.id);
    } catch {
      secondSeedRejected = true;
    }
    assert(secondSeedRejected, "expected a second seed attempt to be rejected — one-time only");
    console.log(
      "PASS: seedFirstBalance creates today's record once; a second attempt is rejected.",
    );

    // ============== 3/4. Delta-based expected-balance check + failing-first variance ==============
    // Today's dev DB may already have real Cash sales from earlier
    // testing this session — read the baseline BEFORE adding a known
    // sale, so the assertion is immune to whatever pre-existing total
    // there is.
    const expectedBefore = await cashReconciliationService.getExpectedEndingBalance(seeded);
    await saleService.createSale({
      category: "PRODUCT",
      amountCents: 150000, // ₱1,500 known Cash sale
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      description: "Cash recon test sale",
    });
    const expectedAfter = await cashReconciliationService.getExpectedEndingBalance(seeded);
    assert(
      expectedAfter - expectedBefore === 150000,
      `expected the known sale to add exactly 150000 to the expected balance, got a delta of ${expectedAfter - expectedBefore}`,
    );
    console.log(
      `PASS: expected ending balance moves by exactly the known Cash sale amount (baseline ${expectedBefore} -> ${expectedAfter}).`,
    );

    // Mismatched confirmation, no note — rejected, proven failing-first.
    const mismatchedCents = expectedAfter + 20000; // ₱200 over
    let rejectedNoNote = false;
    try {
      await cashReconciliationService.confirmBalance(
        today,
        mismatchedCents,
        0,
        undefined,
        employee.id,
        owner.id,
      );
    } catch (error) {
      rejectedNoNote = true;
      assert(
        error instanceof Error && error.message.toLowerCase().includes("expected"),
        `expected a variance-related error, got: ${error}`,
      );
    }
    assert(rejectedNoNote, "expected a mismatched confirmation with no note to be rejected");
    const stillOpen = await cashReconciliationService.getBalanceForDate(today);
    assert(
      stillOpen?.status === "OPEN",
      `expected today's record to remain OPEN after a rejected attempt, got ${stillOpen?.status}`,
    );
    console.log(
      "PASS: a mismatched confirmation with no note is rejected — proven failing-first — and the day stays open.",
    );

    // Same attempt, now with a note — succeeds. Withdraws a known chunk
    // for the bank/safe so scenario 5 below can prove only the leftover
    // carries forward.
    const withdrawnCents = 100000; // ₱1,000 pulled for the bank
    const confirmedToday = await cashReconciliationService.confirmBalance(
      today,
      mismatchedCents,
      withdrawnCents,
      "Counted over — will investigate.",
      employee.id,
      owner.id,
    );
    assert(
      confirmedToday.status === "CONFIRMED",
      `expected CONFIRMED, got ${confirmedToday.status}`,
    );
    assert(
      confirmedToday.varianceCents === 20000,
      `expected varianceCents 20000, got ${confirmedToday.varianceCents}`,
    );
    assert(
      confirmedToday.confirmedEndingBalanceCents === mismatchedCents,
      "expected confirmedEndingBalanceCents to match what was submitted",
    );
    assert(
      confirmedToday.withdrawnCents === withdrawnCents,
      `expected withdrawnCents ${withdrawnCents} to be persisted, got ${confirmedToday.withdrawnCents}`,
    );
    console.log(
      "PASS: confirming with a note succeeds — variance and withdrawn amount computed and persisted correctly.",
    );

    // ============== 5. Carry-forward to tomorrow ==============
    const tomorrowBalance = await cashReconciliationService.getOrCreateBalanceForDate(tomorrow);
    assert(
      tomorrowBalance !== null,
      "expected tomorrow's record to auto-create now that today is CONFIRMED",
    );
    const expectedCarriedForward = confirmedToday.confirmedEndingBalanceCents! - withdrawnCents;
    assert(
      tomorrowBalance!.startingBalanceCents === expectedCarriedForward,
      `expected tomorrow's starting balance to be the drawer leftover (confirmed ending ${confirmedToday.confirmedEndingBalanceCents} minus withdrawn ${withdrawnCents} = ${expectedCarriedForward}), got ${tomorrowBalance!.startingBalanceCents}`,
    );
    console.log(
      "PASS: tomorrow's starting balance carries forward as only the drawer leftover (confirmed ending minus withdrawn) — never the full confirmed count, never re-entered manually.",
    );

    // Tomorrow can have no real Cash sales yet (nothing can be dated in
    // the future), so its expected ending balance is exactly its
    // starting balance — a clean, unambiguous value for the override +
    // exact-match tests below.
    const tomorrowExpected = await cashReconciliationService.getExpectedEndingBalance(
      tomorrowBalance!,
    );
    assert(
      tomorrowExpected === tomorrowBalance!.startingBalanceCents,
      "expected tomorrow's expected balance to equal its starting balance (no sales dated in the future)",
    );

    // ============== 6. Override starting balance — requires a reason, audited ==============
    let overrideRejectedNoReason = false;
    try {
      await cashReconciliationService.overrideStartingBalance(tomorrow, 999999, "", owner.id);
    } catch {
      overrideRejectedNoReason = true;
    }
    assert(overrideRejectedNoReason, "expected an override with no reason to be rejected");

    const oldStarting = tomorrowBalance!.startingBalanceCents;
    const overridden = await cashReconciliationService.overrideStartingBalance(
      tomorrow,
      oldStarting + 30000,
      "Physical count showed an extra P300 in the drawer.",
      owner.id,
    );
    assert(
      overridden.startingBalanceCents === oldStarting + 30000,
      "expected the overridden starting balance to be persisted",
    );

    const overrideAuditLog = await prisma.auditLog.findFirst({
      where: {
        entityType: "CashDailyBalance",
        entityId: overridden.id,
        action: "cash_daily_balance.starting_balance_overridden",
      },
      orderBy: { createdAt: "desc" },
    });
    assert(overrideAuditLog !== null, "expected an audit log entry for the override");
    const newValues = overrideAuditLog!.newValues as {
      startingBalanceCents: number;
      reason: string;
    } | null;
    assert(
      newValues?.reason === "Physical count showed an extra P300 in the drawer.",
      "expected the audit log to record the reason",
    );
    assert(
      newValues?.startingBalanceCents === oldStarting + 30000,
      "expected the audit log to record the new value",
    );
    const oldValues = overrideAuditLog!.oldValues as { startingBalanceCents: number } | null;
    assert(
      oldValues?.startingBalanceCents === oldStarting,
      "expected the audit log to record the old value",
    );
    console.log(
      "PASS: overriding the starting balance requires a reason and is fully audit-logged (who/when already on the row, old/new/reason in the log).",
    );

    // Override refused once the day is CONFIRMED.
    await cashReconciliationService.confirmBalance(
      tomorrow,
      tomorrowExpected + 30000,
      0,
      "expected shift after override",
      employee.id,
      owner.id,
    );
    let overrideRejectedAfterConfirm = false;
    try {
      await cashReconciliationService.overrideStartingBalance(tomorrow, 1, "too late", owner.id);
    } catch (error) {
      overrideRejectedAfterConfirm = error instanceof CashBalanceAlreadyConfirmedError;
    }
    assert(
      overrideRejectedAfterConfirm,
      "expected an override attempt on an already-CONFIRMED day to be rejected",
    );
    console.log(
      "PASS: the starting balance can't be overridden once the day is already confirmed.",
    );

    // ============== 7. reopenBalance — the "closed too early" undo ==============
    let reopenRejectedNoReason = false;
    try {
      await cashReconciliationService.reopenBalance(tomorrow, "", owner.id);
    } catch {
      reopenRejectedNoReason = true;
    }
    assert(reopenRejectedNoReason, "expected reopenBalance with no reason to be rejected");

    const beforeReopen = await cashReconciliationService.getBalanceForDate(tomorrow);
    assert(
      beforeReopen?.status === "CONFIRMED",
      "expected tomorrow to still be CONFIRMED going into the reopen test",
    );
    const originalConfirmedEnding = beforeReopen!.confirmedEndingBalanceCents;

    const reopened = await cashReconciliationService.reopenBalance(
      tomorrow,
      "Closed at 8am before the day's real sales came in.",
      owner.id,
    );
    assert(reopened.status === "OPEN", `expected OPEN after reopening, got ${reopened.status}`);
    assert(
      reopened.confirmedEndingBalanceCents === null,
      "expected confirmedEndingBalanceCents cleared after reopening",
    );
    assert(reopened.withdrawnCents === 0, "expected withdrawnCents reset to 0 after reopening");
    assert(reopened.confirmedAt === null, "expected confirmedAt cleared after reopening");
    console.log(
      "PASS: reopenBalance requires a reason and flips a CONFIRMED day back to OPEN, clearing the confirm-time fields.",
    );

    const reopenAuditLog = await prisma.auditLog.findFirst({
      where: {
        entityType: "CashDailyBalance",
        entityId: reopened.id,
        action: "cash_daily_balance.reopened",
      },
      orderBy: { createdAt: "desc" },
    });
    assert(reopenAuditLog !== null, "expected an audit log entry for the reopen");
    const reopenOldValues = reopenAuditLog!.oldValues as {
      confirmedEndingBalanceCents: number;
      reason: string;
    } | null;
    assert(
      reopenOldValues?.confirmedEndingBalanceCents === originalConfirmedEnding,
      `expected the audit log to preserve the original confirmed ending balance (${originalConfirmedEnding}), got ${reopenOldValues?.confirmedEndingBalanceCents}`,
    );
    assert(
      reopenOldValues?.reason === "Closed at 8am before the day's real sales came in.",
      "expected the audit log to record the reopen reason",
    );
    console.log("PASS: the original confirmed numbers survive in the audit trail even after reopening.");

    // Reject reopening a day that's already OPEN — nothing to reopen.
    let reopenRejectedAlreadyOpen = false;
    try {
      await cashReconciliationService.reopenBalance(tomorrow, "trying again", owner.id);
    } catch {
      reopenRejectedAlreadyOpen = true;
    }
    assert(reopenRejectedAlreadyOpen, "expected reopening an already-OPEN day to be rejected");
    console.log("PASS: reopening a day that's already OPEN is rejected — nothing to undo.");

    // The reopened day can be confirmed again, cleanly, with a corrected amount.
    const reconfirmed = await cashReconciliationService.confirmBalance(
      tomorrow,
      tomorrowExpected + 30000,
      0,
      "Corrected close with the full day's sales.",
      employee.id,
      owner.id,
    );
    assert(reconfirmed.status === "CONFIRMED", "expected the reopened day to be confirmable again");
    console.log("PASS: a reopened day can be confirmed again with the corrected numbers.");

    await cleanUp(employeeId);
    console.log("\nPASS: Cash reconciliation proven against real rows.");
  } catch (error) {
    await cleanUp(employeeId);
    throw error;
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
