/**
 * GCash reconciliation — Gate 1. Same discipline as shift cash
 * reconciliation, built on the same proven pattern, but date-scoped
 * (one shared running balance for the whole business) rather than
 * shift-scoped.
 *
 * Proves, against real rows:
 *   1. No prior CONFIRMED day -> getOrCreateBalanceForDate returns
 *      null, not a crash — the "needs seed" state is a real, handled
 *      case.
 *   2. seedFirstBalance creates today's record; a second seed attempt
 *      is rejected (one-time only).
 *   3. Carry-forward: confirming today auto-creates tomorrow's record
 *      with startingBalanceCents equal to today's confirmed ending
 *      balance — never re-entered manually.
 *   4. A mismatched confirmation with no note is rejected — proven
 *      failing-first: the exact same attempt, only difference is a
 *      note, then succeeds, with the correct variance persisted.
 *   5. overrideStartingBalance requires a reason, writes an audit-log
 *      entry with the old and new value, and is refused once the day
 *      is already CONFIRMED.
 *   8. A GCash-paid expense subtracts exactly its own amount from
 *      getExpectedEndingBalance (owner request, 2026-08-07) — same
 *      delta-based proof as the known-sale check above, immune to
 *      whatever else already happened today.
 *
 * Uses real "today"/"tomorrow" dates (seedFirstBalance always targets
 * today internally, by design — there's no "first ever day" concept
 * for an arbitrary past date), and cleans up every GcashDailyBalance
 * row from today forward at the end, restoring the table to whatever
 * state it was in before this ran (empty, in a fresh dev environment
 * that has never used this feature yet).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { expenseService } from "../expenses/expense.service";
import { gcashReconciliationService, GcashBalanceAlreadyConfirmedError, PriorDayNotClosedError } from "./gcash-reconciliation.service";
import { saleService } from "../sales/sale.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const TEST_USERNAME_PREFIX = "gcash-recon-test-";

function toMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

async function createEmployee(username: string): Promise<{ id: string; userId: string }> {
  const role = await prisma.role.findFirstOrThrow({ where: { name: "COURT_ATTENDANT" } });
  const user = await prisma.user.create({ data: { name: username, username, roleId: role.id } });
  return prisma.employee.create({
    data: { userId: user.id, employeeNumber: `${username}-num`, firstName: "Test", lastName: "GcashRecon" },
  });
}

async function cleanUp(employeeId?: string): Promise<void> {
  const today = toMidnight(new Date());
  await prisma.gcashDailyBalance.deleteMany({ where: { date: { gte: today } } });

  if (employeeId) {
    await prisma.sale.deleteMany({ where: { employeeId } });
    await prisma.expense.deleteMany({ where: { recordedByEmployeeId: employeeId } });
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

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  const today = toMidnight(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let employeeId: string | undefined;

  try {
    const employee = await createEmployee(`${TEST_USERNAME_PREFIX}${Date.now()}`);
    employeeId = employee.id;
    const shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-GCASH-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
    });

    // ============== 1. No prior CONFIRMED day -> null, not a crash ==============
    const noDay = await gcashReconciliationService.getOrCreateBalanceForDate(today);
    assert(noDay === null, `expected null with no prior CONFIRMED day, got ${JSON.stringify(noDay)}`);
    console.log("PASS: with no prior CONFIRMED day, getOrCreateBalanceForDate returns null — a real handled case, not a crash.");

    // ============== 2. One-time seed; a second attempt is rejected ==============
    const seeded = await gcashReconciliationService.seedFirstBalance(500000, owner.id); // ₱5,000
    assert(seeded.date.getTime() === today.getTime(), "expected the seed to target today");
    assert(seeded.startingBalanceCents === 500000, `expected startingBalanceCents 500000, got ${seeded.startingBalanceCents}`);
    assert(seeded.status === "OPEN", `expected OPEN, got ${seeded.status}`);

    let secondSeedRejected = false;
    try {
      await gcashReconciliationService.seedFirstBalance(999999, owner.id);
    } catch {
      secondSeedRejected = true;
    }
    assert(secondSeedRejected, "expected a second seed attempt to be rejected — one-time only");
    console.log("PASS: seedFirstBalance creates today's record once; a second attempt is rejected.");

    // ============== 3/4. Delta-based expected-balance check + failing-first variance ==============
    // Today's dev DB may already have real GCash sales from earlier
    // testing this session — read the baseline BEFORE adding a known
    // sale, so the assertion is immune to whatever pre-existing total
    // there is.
    const expectedBefore = await gcashReconciliationService.getExpectedEndingBalance(seeded);
    await saleService.createSale({
      category: "PRODUCT",
      amountCents: 150000, // ₱1,500 known GCash sale
      paymentMethodId: gcashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      description: "GCash recon test sale",
    });
    const expectedAfter = await gcashReconciliationService.getExpectedEndingBalance(seeded);
    assert(expectedAfter - expectedBefore === 150000, `expected the known sale to add exactly 150000 to the expected balance, got a delta of ${expectedAfter - expectedBefore}`);
    console.log(`PASS: expected ending balance moves by exactly the known GCash sale amount (baseline ${expectedBefore} -> ${expectedAfter}).`);

    // Mismatched confirmation, no note — rejected, proven failing-first.
    const mismatchedCents = expectedAfter + 20000; // ₱200 over
    let rejectedNoNote = false;
    try {
      await gcashReconciliationService.confirmBalance(today, mismatchedCents, undefined, employee.id, owner.id);
    } catch (error) {
      rejectedNoNote = true;
      assert(error instanceof Error && error.message.toLowerCase().includes("expected"), `expected a variance-related error, got: ${error}`);
    }
    assert(rejectedNoNote, "expected a mismatched confirmation with no note to be rejected");
    const stillOpen = await gcashReconciliationService.getBalanceForDate(today);
    assert(stillOpen?.status === "OPEN", `expected today's record to remain OPEN after a rejected attempt, got ${stillOpen?.status}`);
    console.log("PASS: a mismatched confirmation with no note is rejected — proven failing-first — and the day stays open.");

    // Same attempt, now with a note — succeeds.
    const confirmedToday = await gcashReconciliationService.confirmBalance(
      today,
      mismatchedCents,
      "Counted over — will investigate.",
      employee.id,
      owner.id,
    );
    assert(confirmedToday.status === "CONFIRMED", `expected CONFIRMED, got ${confirmedToday.status}`);
    assert(confirmedToday.varianceCents === 20000, `expected varianceCents 20000, got ${confirmedToday.varianceCents}`);
    assert(confirmedToday.confirmedEndingBalanceCents === mismatchedCents, "expected confirmedEndingBalanceCents to match what was submitted");
    console.log("PASS: confirming with a note succeeds — variance computed and persisted correctly.");

    // ============== 5. Carry-forward to tomorrow ==============
    const tomorrowBalance = await gcashReconciliationService.getOrCreateBalanceForDate(tomorrow);
    assert(tomorrowBalance !== null, "expected tomorrow's record to auto-create now that today is CONFIRMED");
    assert(
      tomorrowBalance!.startingBalanceCents === confirmedToday.confirmedEndingBalanceCents,
      `expected tomorrow's starting balance to carry forward from today's confirmed ending (${confirmedToday.confirmedEndingBalanceCents}), got ${tomorrowBalance!.startingBalanceCents}`,
    );
    console.log("PASS: tomorrow's starting balance carries forward automatically from today's confirmed ending balance — never re-entered manually.");

    // Tomorrow can have no real GCash sales yet (nothing can be dated in
    // the future), so its expected ending balance is exactly its
    // starting balance — a clean, unambiguous value for the override +
    // exact-match tests below.
    const tomorrowExpected = await gcashReconciliationService.getExpectedEndingBalance(tomorrowBalance!);
    assert(tomorrowExpected === tomorrowBalance!.startingBalanceCents, "expected tomorrow's expected balance to equal its starting balance (no sales dated in the future)");

    // ============== Fix 2: getOrCreateBalanceForDate refuses to skip a
    // still-open day (real incident, 2026-08-07) ==============
    // Reproduces the exact live bug's setup: today is CONFIRMED, tomorrow
    // is still OPEN (deliberately left unconfirmed here). Before the fix,
    // getOrCreateBalanceForDate would silently skip past tomorrow and
    // pull today's confirmed ending instead — proven failing-first: it
    // must now throw PriorDayNotClosedError and create nothing.
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    let skipRefused = false;
    try {
      await gcashReconciliationService.getOrCreateBalanceForDate(dayAfterTomorrow);
    } catch (error) {
      skipRefused =
        error instanceof PriorDayNotClosedError && error.priorDate.getTime() === tomorrow.getTime();
    }
    assert(skipRefused, "expected getOrCreateBalanceForDate to refuse, naming tomorrow specifically, instead of skipping past it to an older confirmed day");
    const dayAfterTomorrowNotCreated = await gcashReconciliationService.getBalanceForDate(dayAfterTomorrow);
    assert(dayAfterTomorrowNotCreated === null, "expected no row to have been created for dayAfterTomorrow at all — never a wrong number, per the owner's own framing");
    console.log("PASS: getOrCreateBalanceForDate refuses to skip past an unconfirmed day — the exact live incident's root cause can't happen again.");

    // ============== Fix 1: confirmBalance's own independent guard
    // ============== ==============
    // Fix 2 above stops the NORMAL path from ever creating a stray later
    // row — but a later row can still exist through a different, real
    // sequence: it auto-created while the earlier day WAS confirmed, and
    // that earlier day was THEN reopened (e.g. "closed too early," a
    // real, supported action) — leaving the later row's starting balance
    // stale relative to the earlier day's still-unresolved reclose. This
    // is why confirmBalance needs its own guard, independent of Fix 2 —
    // simulated directly here (bypassing the normal create path) so this
    // proves confirmBalance's guard specifically, not Fix 2's.
    const staleLaterDay = await prisma.gcashDailyBalance.create({
      data: { date: dayAfterTomorrow, startingBalanceCents: tomorrowBalance!.startingBalanceCents },
    });
    assert(staleLaterDay.status === "OPEN", "expected the simulated later row to start OPEN");

    let orderingGuardRejected = false;
    try {
      await gcashReconciliationService.confirmBalance(
        dayAfterTomorrow,
        staleLaterDay.startingBalanceCents,
        undefined,
        employee.id,
        owner.id,
      );
    } catch (error) {
      orderingGuardRejected = error instanceof Error && error.message.includes("still open");
    }
    assert(orderingGuardRejected, "expected confirming dayAfterTomorrow to be refused while tomorrow is still OPEN — proven failing-first against the exact live incident");
    const stillOpenDayAfter = await gcashReconciliationService.getBalanceForDate(dayAfterTomorrow);
    assert(stillOpenDayAfter?.status === "OPEN", "expected dayAfterTomorrow to remain OPEN, untouched, after the refused attempt");
    console.log("PASS: confirmBalance independently refuses a later day while an earlier day is still open — the exact live incident can't happen again, even via a stray existing row.");

    // ============== 6. Override starting balance — requires a reason, audited ==============
    let overrideRejectedNoReason = false;
    try {
      await gcashReconciliationService.overrideStartingBalance(tomorrow, 999999, "", owner.id);
    } catch {
      overrideRejectedNoReason = true;
    }
    assert(overrideRejectedNoReason, "expected an override with no reason to be rejected");

    const oldStarting = tomorrowBalance!.startingBalanceCents;
    const overridden = await gcashReconciliationService.overrideStartingBalance(
      tomorrow,
      oldStarting + 30000,
      "GCash app shows an extra P300 from an external transfer.",
      owner.id,
    );
    assert(overridden.startingBalanceCents === oldStarting + 30000, "expected the overridden starting balance to be persisted");

    const overrideAuditLog = await prisma.auditLog.findFirst({
      where: { entityType: "GcashDailyBalance", entityId: overridden.id, action: "gcash_daily_balance.starting_balance_overridden" },
      orderBy: { createdAt: "desc" },
    });
    assert(overrideAuditLog !== null, "expected an audit log entry for the override");
    const newValues = overrideAuditLog!.newValues as { startingBalanceCents: number; reason: string } | null;
    assert(newValues?.reason === "GCash app shows an extra P300 from an external transfer.", "expected the audit log to record the reason");
    assert(newValues?.startingBalanceCents === oldStarting + 30000, "expected the audit log to record the new value");
    const oldValues = overrideAuditLog!.oldValues as { startingBalanceCents: number } | null;
    assert(oldValues?.startingBalanceCents === oldStarting, "expected the audit log to record the old value");
    console.log("PASS: overriding the starting balance requires a reason and is fully audit-logged (who/when already on the row, old/new/reason in the log).");

    // Override refused once the day is CONFIRMED.
    await gcashReconciliationService.confirmBalance(tomorrow, tomorrowExpected + 30000, "expected shift after override", employee.id, owner.id);
    let overrideRejectedAfterConfirm = false;
    try {
      await gcashReconciliationService.overrideStartingBalance(tomorrow, 1, "too late", owner.id);
    } catch (error) {
      overrideRejectedAfterConfirm = error instanceof GcashBalanceAlreadyConfirmedError;
    }
    assert(overrideRejectedAfterConfirm, "expected an override attempt on an already-CONFIRMED day to be rejected");
    console.log("PASS: the starting balance can't be overridden once the day is already confirmed.");

    // ============== 7. reopenBalance — the "closed too early" undo ==============
    let reopenRejectedNoReason = false;
    try {
      await gcashReconciliationService.reopenBalance(tomorrow, "", owner.id);
    } catch {
      reopenRejectedNoReason = true;
    }
    assert(reopenRejectedNoReason, "expected reopenBalance with no reason to be rejected");

    const beforeReopen = await gcashReconciliationService.getBalanceForDate(tomorrow);
    assert(beforeReopen?.status === "CONFIRMED", "expected tomorrow to still be CONFIRMED going into the reopen test");
    const originalConfirmedEnding = beforeReopen!.confirmedEndingBalanceCents;

    const reopened = await gcashReconciliationService.reopenBalance(
      tomorrow,
      "Closed at 8am before the day's real sales came in.",
      owner.id,
    );
    assert(reopened.status === "OPEN", `expected OPEN after reopening, got ${reopened.status}`);
    assert(reopened.confirmedEndingBalanceCents === null, "expected confirmedEndingBalanceCents cleared after reopening");
    assert(reopened.confirmedAt === null, "expected confirmedAt cleared after reopening");
    console.log("PASS: reopenBalance requires a reason and flips a CONFIRMED day back to OPEN, clearing the confirm-time fields.");

    const reopenAuditLog = await prisma.auditLog.findFirst({
      where: { entityType: "GcashDailyBalance", entityId: reopened.id, action: "gcash_daily_balance.reopened" },
      orderBy: { createdAt: "desc" },
    });
    assert(reopenAuditLog !== null, "expected an audit log entry for the reopen");
    const reopenOldValues = reopenAuditLog!.oldValues as { confirmedEndingBalanceCents: number; reason: string } | null;
    assert(
      reopenOldValues?.confirmedEndingBalanceCents === originalConfirmedEnding,
      `expected the audit log to preserve the original confirmed ending balance (${originalConfirmedEnding}), got ${reopenOldValues?.confirmedEndingBalanceCents}`,
    );
    assert(reopenOldValues?.reason === "Closed at 8am before the day's real sales came in.", "expected the audit log to record the reopen reason");
    console.log("PASS: the original confirmed numbers survive in the audit trail even after reopening.");

    // Reject reopening a day that's already OPEN — nothing to reopen.
    let reopenRejectedAlreadyOpen = false;
    try {
      await gcashReconciliationService.reopenBalance(tomorrow, "trying again", owner.id);
    } catch {
      reopenRejectedAlreadyOpen = true;
    }
    assert(reopenRejectedAlreadyOpen, "expected reopening an already-OPEN day to be rejected");
    console.log("PASS: reopening a day that's already OPEN is rejected — nothing to undo.");

    // The reopened day can be confirmed again, cleanly, with a corrected amount.
    const reconfirmed = await gcashReconciliationService.confirmBalance(
      tomorrow,
      tomorrowExpected + 30000,
      "Corrected close with the full day's sales.",
      employee.id,
      owner.id,
    );
    assert(reconfirmed.status === "CONFIRMED", "expected the reopened day to be confirmable again");
    console.log("PASS: a reopened day can be confirmed again with the corrected numbers.");

    // ============== 8. A GCash-paid expense subtracts from the expected balance ==============
    const category = await prisma.expenseCategory.findFirstOrThrow();
    const expectedBeforeExpense = await gcashReconciliationService.getExpectedEndingBalance(seeded);
    await expenseService.createExpense(
      {
        amountCents: 45000, // ₱450 known GCash-paid expense
        date: today,
        description: "GCash recon test expense",
        categoryId: category.id,
        paymentMethodId: gcashMethod.id,
        recordedByEmployeeId: employee.id,
      },
      owner.id,
    );
    const expectedAfterExpense = await gcashReconciliationService.getExpectedEndingBalance(seeded);
    assert(
      expectedBeforeExpense - expectedAfterExpense === 45000,
      `expected the known GCash expense to subtract exactly 45000 from the expected balance, got a delta of ${expectedBeforeExpense - expectedAfterExpense}`,
    );
    console.log(`PASS: a GCash-paid expense subtracts exactly its own amount from the expected balance (${expectedBeforeExpense} -> ${expectedAfterExpense}).`);

    await cleanUp(employeeId);
    console.log("\nPASS: GCash reconciliation proven against real rows.");
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
