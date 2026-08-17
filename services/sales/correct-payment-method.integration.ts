/**
 * Owner request (2026-08-08): an attendant sometimes records a Cash
 * payment as GCash (or the reverse) — leaves cash short and GCash over by
 * the same amount. Investigation (report-only) confirmed no correction
 * path existed; the only post-creation Sale mutation was voidSale, an
 * all-or-nothing offsetting entry. This is the real fix: the underlying
 * Sale gets corrected so the variance disappears legitimately.
 *
 * Proves, against real rows, saleService.correctPaymentMethod:
 *   1. A CASH sale corrected to GCASH actually updates
 *      Sale.paymentMethodId, stamps paymentMethodCorrectedAt/Reason/
 *      EmployeeId, and writes an audit log entry with oldValues/newValues
 *      — same "no anonymous adjustments" shape as writeOffTab.
 *   2. An empty reason is rejected — the sale is untouched.
 *   3. Blocked when the FROM date's CashDailyBalance is already CONFIRMED.
 *   4. Blocked when the TO date's GcashDailyBalance is already CONFIRMED
 *      — even though the FROM side (Cash) is still OPEN.
 *   5. Allowed once that day's balance is OPEN again (proves the block is
 *      genuinely status-conditional, not a blanket refusal).
 *   6. A stale/mismatched fromPaymentMethodId (the sale already changed
 *      since the caller loaded it) is rejected, not silently applied on
 *      top of the new value.
 *   7. A VOID sale can't be corrected.
 *   8. Regression (audit 2026-08-16): a sale rung up at 1:30 AM belongs to
 *      the PREVIOUS business day (rollover hour 3) — the confirmed-day
 *      block must key off that day, not createdAt's calendar date.
 *   9. Regression (audit 2026-08-16): an Open Play tab settled the NEXT
 *      day belongs to the night it was opened (Sale.businessDate is taken
 *      from PlayerTab.date, not from createdAt) — same block, same
 *      reasoning, and a case the rollover hour alone can't explain.
 *
 * Cases 8-9 both FAILED before the fix. assertReconciliationDayNotConfirmed
 * derived the day from sale.createdAt, while every reconciliation sum keys
 * off sale.businessDate — so a correction could silently rewrite the total
 * of a day staff had already signed off on, which is the exact invariant
 * this block exists to protect.
 *
 * Uses fixed, far-past isolated dates (safely outside any real business
 * date this app has ever operated on) — same convention as
 * cash-reconciliation-midnight-shift-carryover.integration.ts.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { saleService } from "./sale.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const DAY_CONFIRMED_CASH = new Date(2021, 5, 1);
const DAY_CONFIRMED_GCASH = new Date(2021, 5, 2);
const DAY_OPEN = new Date(2021, 5, 3);

// Cases 8-9: the business day the sale really belongs to (what
// CashDailyBalance.date holds — always midnight-normalized) deliberately
// differs from its createdAt calendar date.
const NIGHT_ROLLOVER = new Date(2021, 5, 5);
const SALE_AFTER_MIDNIGHT = new Date(2021, 5, 6, 1, 30, 0, 0);
const NIGHT_TAB = new Date(2021, 5, 7);
const TAB_SETTLED_NEXT_DAY = new Date(2021, 5, 8, 14, 0, 0, 0);

const ALL_FIXTURE_DATES = [
  DAY_CONFIRMED_CASH,
  DAY_CONFIRMED_GCASH,
  DAY_OPEN,
  NIGHT_ROLLOVER,
  NIGHT_TAB,
];

// Cases 1-7 are about a day's CONFIRMED/OPEN status, NOT about the
// rollover boundary — so their sales are stamped at midday, where
// createdAt's calendar date and the derived businessDate agree. Left at
// bare midnight these fixtures silently landed on the PREVIOUS business
// day (rollover hour 3), which is the very confusion cases 8-9 pin down.
function atMidday(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

async function cleanUpDates(): Promise<void> {
  await prisma.cashDailyBalance.deleteMany({ where: { date: { in: ALL_FIXTURE_DATES } } });
  await prisma.gcashDailyBalance.deleteMany({ where: { date: { in: ALL_FIXTURE_DATES } } });
}

// Deleted before the registration it points at, and after the shift
// cleanup that removes the Sale referencing the tab.
async function cleanUpOpenPlayFixtures(): Promise<void> {
  await prisma.playerTab.deleteMany({ where: { date: NIGHT_TAB } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { date: NIGHT_TAB } });
}

async function cleanUpShift(shiftId: string): Promise<void> {
  await prisma.sale.deleteMany({ where: { shiftId } });
  await prisma.shift.delete({ where: { id: shiftId } }).catch(() => undefined);
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  await cleanUpDates();
  const shift = await prisma.shift.create({
    data: { shiftNumber: `SHIFT-CORRECT-PM-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
  });

  try {
    // ============== 1. Happy path — corrects the Sale, stamps the correction, audit-logs it ==============
    const sale1 = await saleService.createSale({
      category: "OTHER",
      amountCents: 35000,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      createdAt: atMidday(DAY_OPEN),
      description: "Mis-tapped as Cash, should have been GCash",
    });

    const corrected = await saleService.correctPaymentMethod(
      sale1.id,
      cashMethod.id,
      gcashMethod.id,
      "Attendant confirmed this was actually paid via GCash, screenshot on file.",
      employee.id,
      owner.id,
    );
    assert(
      corrected.paymentMethodId === gcashMethod.id,
      `expected paymentMethodId to become GCASH, got ${corrected.paymentMethodId}`,
    );
    assert(corrected.paymentMethodCorrectedAt !== null, "expected paymentMethodCorrectedAt to be stamped");
    assert(
      corrected.paymentMethodCorrectionReason?.includes("screenshot on file"),
      `expected the reason to be stored verbatim, got ${corrected.paymentMethodCorrectionReason}`,
    );
    assert(
      corrected.paymentMethodCorrectedByEmployeeId === employee.id,
      "expected the correcting employee to be attributed",
    );
    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "Sale", entityId: sale1.id, action: "sale.payment_method_corrected" },
    });
    assert(auditEntry, "expected a sale.payment_method_corrected audit log entry");
    const oldValues = auditEntry!.oldValues as { paymentMethodId: string } | null;
    const newValues = auditEntry!.newValues as { paymentMethodId: string; reason: string } | null;
    assert(
      oldValues?.paymentMethodId === cashMethod.id,
      `expected the audit log's oldValues to record the original CASH id, got ${JSON.stringify(oldValues)}`,
    );
    assert(
      newValues?.paymentMethodId === gcashMethod.id,
      `expected the audit log's newValues to record the new GCASH id, got ${JSON.stringify(newValues)}`,
    );
    console.log(
      "PASS: correcting a sale's payment method updates the row, stamps the correction, and audit-logs old/new values.",
    );

    // ============== 2. Empty reason rejected, sale untouched ==============
    const sale2 = await saleService.createSale({
      category: "OTHER",
      amountCents: 10000,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      createdAt: atMidday(DAY_OPEN),
    });
    let reasonRejected = false;
    try {
      await saleService.correctPaymentMethod(sale2.id, cashMethod.id, gcashMethod.id, "   ", employee.id, owner.id);
    } catch (error) {
      reasonRejected = true;
      assert(String(error).includes("reason is required"), `expected a reason-required error, got ${error}`);
    }
    assert(reasonRejected, "expected an empty/whitespace-only reason to be rejected");
    const sale2After = await prisma.sale.findUniqueOrThrow({ where: { id: sale2.id } });
    assert(sale2After.paymentMethodId === cashMethod.id, "expected the sale to remain unchanged after a rejected correction");
    console.log("PASS: an empty reason is rejected — the sale is left untouched.");

    // ============== 3. Blocked when the FROM date's CashDailyBalance is CONFIRMED ==============
    await prisma.cashDailyBalance.create({
      data: { date: DAY_CONFIRMED_CASH, startingBalanceCents: 0, status: "CONFIRMED" },
    });
    const sale3 = await saleService.createSale({
      category: "OTHER",
      amountCents: 20000,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      createdAt: atMidday(DAY_CONFIRMED_CASH),
    });
    let blockedOnFrom = false;
    try {
      await saleService.correctPaymentMethod(
        sale3.id,
        cashMethod.id,
        gcashMethod.id,
        "Should be blocked — cash day is confirmed.",
        employee.id,
        owner.id,
      );
    } catch (error) {
      blockedOnFrom = true;
      assert(String(error).includes("already confirmed"), `expected an already-confirmed error, got ${error}`);
    }
    assert(blockedOnFrom, "expected the correction to be blocked when the FROM day's cash reconciliation is confirmed");
    console.log("PASS: blocked when the FROM date's cash reconciliation is already confirmed.");

    // ============== 4. Blocked when the TO date's GcashDailyBalance is CONFIRMED, even though FROM (Cash) is OPEN ==============
    await prisma.gcashDailyBalance.create({
      data: { date: DAY_CONFIRMED_GCASH, startingBalanceCents: 0, status: "CONFIRMED" },
    });
    const sale4 = await saleService.createSale({
      category: "OTHER",
      amountCents: 15000,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      createdAt: atMidday(DAY_CONFIRMED_GCASH),
    });
    let blockedOnTo = false;
    try {
      await saleService.correctPaymentMethod(
        sale4.id,
        cashMethod.id,
        gcashMethod.id,
        "Should be blocked — the GCash day it would move into is confirmed.",
        employee.id,
        owner.id,
      );
    } catch (error) {
      blockedOnTo = true;
      assert(String(error).includes("already confirmed"), `expected an already-confirmed error, got ${error}`);
    }
    assert(blockedOnTo, "expected the correction to be blocked when the TO day's GCash reconciliation is confirmed");
    console.log("PASS: blocked when the TO date's GCash reconciliation is already confirmed, even with Cash still open.");

    // ============== 5. Allowed once the day is reopened ==============
    await prisma.gcashDailyBalance.update({
      where: { date: DAY_CONFIRMED_GCASH },
      data: { status: "OPEN" },
    });
    const correctedAfterReopen = await saleService.correctPaymentMethod(
      sale4.id,
      cashMethod.id,
      gcashMethod.id,
      "Day was reopened — correction now allowed.",
      employee.id,
      owner.id,
    );
    assert(
      correctedAfterReopen.paymentMethodId === gcashMethod.id,
      "expected the correction to succeed once the GCash day was reopened",
    );
    console.log("PASS: allowed once the reconciliation day is reopened — the block is status-conditional, not blanket.");

    // ============== 6. Stale fromPaymentMethodId rejected ==============
    let staleRejected = false;
    try {
      // sale4 is now GCASH (from step 5) — claiming it was still CASH is stale.
      await saleService.correctPaymentMethod(
        sale4.id,
        cashMethod.id,
        gcashMethod.id,
        "Stale claim — should be rejected.",
        employee.id,
        owner.id,
      );
    } catch (error) {
      staleRejected = true;
      assert(String(error).includes("already changed"), `expected an already-changed error, got ${error}`);
    }
    assert(staleRejected, "expected a stale fromPaymentMethodId claim to be rejected");
    console.log("PASS: a stale/mismatched fromPaymentMethodId is rejected, not silently applied on top of a newer value.");

    // ============== 7. A VOID sale can't be corrected ==============
    const sale5 = await saleService.createSale({
      category: "OTHER",
      amountCents: 5000,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      createdAt: atMidday(DAY_OPEN),
    });
    await saleService.voidSale(sale5.id);
    let voidRejected = false;
    try {
      await saleService.correctPaymentMethod(
        sale5.id,
        cashMethod.id,
        gcashMethod.id,
        "Should be rejected — sale is VOID.",
        employee.id,
        owner.id,
      );
    } catch (error) {
      voidRejected = true;
      assert(String(error).includes("COMPLETED"), `expected a COMPLETED-only error, got ${error}`);
    }
    assert(voidRejected, "expected a VOID sale to be rejected");
    console.log("PASS: a VOID sale can't have its payment method corrected.");

    // ============== 8. Rollover boundary — a 1:30 AM sale belongs to the PREVIOUS business day ==============
    // The night of Jun 5 is confirmed and signed off. A sale rung up at
    // 1:30 AM on Jun 6 is still part of THAT night's takings (rollover
    // hour 3), and getCashSalesForDate counts it under Jun 5. Jun 6
    // deliberately has no balance row at all, so a guard that keys off
    // createdAt's calendar date finds nothing and waves the correction through.
    await prisma.cashDailyBalance.create({
      data: { date: NIGHT_ROLLOVER, startingBalanceCents: 0, status: "CONFIRMED" },
    });
    const saleAfterMidnight = await saleService.createSale({
      category: "OTHER",
      amountCents: 30000,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      createdAt: SALE_AFTER_MIDNIGHT,
    });
    assert(
      saleAfterMidnight.businessDate?.getTime() === NIGHT_ROLLOVER.getTime(),
      `fixture check: expected businessDate ${NIGHT_ROLLOVER.toDateString()}, got ${saleAfterMidnight.businessDate?.toDateString()}`,
    );
    let afterMidnightBlocked = false;
    try {
      await saleService.correctPaymentMethod(
        saleAfterMidnight.id,
        cashMethod.id,
        gcashMethod.id,
        "Should be blocked — this sale is counted in Jun 5's confirmed cash.",
        employee.id,
        owner.id,
      );
    } catch (error) {
      afterMidnightBlocked = true;
      assert(String(error).includes("already confirmed"), `expected an already-confirmed error, got ${error}`);
    }
    assert(
      afterMidnightBlocked,
      "expected a 1:30 AM sale to be blocked by the PREVIOUS business day's confirmed cash reconciliation",
    );
    console.log("PASS: a post-midnight sale is blocked by its own business day, not its createdAt calendar date.");

    // ============== 9. An Open Play tab settled the next day belongs to the night it was opened ==============
    // Not a rollover-hour case at all: createSale takes businessDate
    // straight from PlayerTab.date, so a tab opened on the night of
    // Jun 7 and settled at 2 PM on Jun 8 is counted under Jun 7 — a full
    // 14 hours past any rollover boundary.
    await prisma.cashDailyBalance.create({
      data: { date: NIGHT_TAB, startingBalanceCents: 0, status: "CONFIRMED" },
    });
    const registration = await prisma.openPlayNightRegistration.create({
      data: {
        date: NIGHT_TAB,
        playerName: "Regression Fixture Player",
        phone: "09170000001",
        skillLevel: "INTERMEDIATE",
        source: "WALK_IN",
      },
    });
    const tab = await prisma.playerTab.create({
      data: {
        date: NIGHT_TAB,
        registrationId: registration.id,
        playerName: registration.playerName,
        gameRateCents: 3500,
      },
    });
    const tabSale = await saleService.createSale({
      category: "OPEN_PLAY",
      amountCents: 10500,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      playerTabId: tab.id,
      createdAt: TAB_SETTLED_NEXT_DAY,
    });
    assert(
      tabSale.businessDate?.getTime() === NIGHT_TAB.getTime(),
      `fixture check: expected businessDate ${NIGHT_TAB.toDateString()}, got ${tabSale.businessDate?.toDateString()}`,
    );
    let tabSaleBlocked = false;
    try {
      await saleService.correctPaymentMethod(
        tabSale.id,
        cashMethod.id,
        gcashMethod.id,
        "Should be blocked — this tab is counted in Jun 7's confirmed cash.",
        employee.id,
        owner.id,
      );
    } catch (error) {
      tabSaleBlocked = true;
      assert(String(error).includes("already confirmed"), `expected an already-confirmed error, got ${error}`);
    }
    assert(
      tabSaleBlocked,
      "expected an Open Play tab settled the next day to be blocked by its own night's confirmed cash reconciliation",
    );
    console.log("PASS: an Open Play tab settled the next day is blocked by the night it belongs to.");

    console.log(
      "\nPASS: payment-method correction is real, audit-logged, and correctly blocked by a confirmed reconciliation day.",
    );
  } finally {
    await cleanUpShift(shift.id);
    await cleanUpOpenPlayFixtures();
    await cleanUpDates();
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
