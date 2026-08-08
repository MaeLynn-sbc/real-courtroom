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

async function cleanUpDates(): Promise<void> {
  await prisma.cashDailyBalance.deleteMany({
    where: { date: { in: [DAY_CONFIRMED_CASH, DAY_CONFIRMED_GCASH, DAY_OPEN] } },
  });
  await prisma.gcashDailyBalance.deleteMany({
    where: { date: { in: [DAY_CONFIRMED_CASH, DAY_CONFIRMED_GCASH, DAY_OPEN] } },
  });
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
      createdAt: DAY_OPEN,
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
      createdAt: DAY_OPEN,
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
      createdAt: DAY_CONFIRMED_CASH,
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
      createdAt: DAY_CONFIRMED_GCASH,
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
      createdAt: DAY_OPEN,
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

    console.log(
      "\nPASS: payment-method correction is real, audit-logged, and correctly blocked by a confirmed reconciliation day.",
    );
  } finally {
    await cleanUpShift(shift.id);
    await cleanUpDates();
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
