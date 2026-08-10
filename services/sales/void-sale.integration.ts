/**
 * Owner request (2026-08-10): "the staff encoded wrong product and wants
 * it to void. is there an option for the owner to change or void it?" —
 * investigation confirmed voidSale (the primitive) existed but was only
 * ever called internally by bookingRefundService, with no reason/employee
 * attribution and no owner-facing action. voidSaleAsCorrection is the
 * real fix, following correctPaymentMethod's own pattern exactly.
 *
 * Proves, against real rows, saleService.voidSaleAsCorrection:
 *   1. Voids a COMPLETED sale, stamps voidedAt/voidReason/
 *      voidedByEmployeeId, and writes an audit log entry with
 *      oldValues/newValues.
 *   2. An empty reason is rejected — the sale is untouched.
 *   3. Blocked when that day's CashDailyBalance is already CONFIRMED.
 *   4. Allowed once the day is reopened.
 *   5. A sale that's already VOID can't be voided again.
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

const DAY_CONFIRMED = new Date(2021, 5, 10);
const DAY_OPEN = new Date(2021, 5, 11);

async function cleanUpDates(): Promise<void> {
  await prisma.cashDailyBalance.deleteMany({ where: { date: { in: [DAY_CONFIRMED, DAY_OPEN] } } });
}

async function cleanUpShift(shiftId: string): Promise<void> {
  await prisma.sale.deleteMany({ where: { shiftId } });
  await prisma.shift.delete({ where: { id: shiftId } }).catch(() => undefined);
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

  await cleanUpDates();
  const shift = await prisma.shift.create({
    data: { shiftNumber: `SHIFT-VOID-SALE-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
  });

  try {
    // ============== 1. Happy path — voids the sale, stamps it, audit-logs it ==============
    const sale1 = await saleService.createSale({
      category: "PRODUCT",
      amountCents: 25000,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      createdAt: DAY_OPEN,
      description: "Wrong product rung up by mistake",
    });

    const voided = await saleService.voidSaleAsCorrection(
      sale1.id,
      "Staff rang up the wrong product — this sale never happened.",
      employee.id,
      owner.id,
    );
    assert(voided.status === "VOID", `expected status VOID, got ${voided.status}`);
    assert(voided.voidedAt !== null, "expected voidedAt to be stamped");
    assert(
      voided.voidReason?.includes("wrong product"),
      `expected the reason to be stored verbatim, got ${voided.voidReason}`,
    );
    assert(voided.voidedByEmployeeId === employee.id, "expected the voiding employee to be attributed");
    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "Sale", entityId: sale1.id, action: "sale.voided_as_correction" },
    });
    assert(auditEntry, "expected a sale.voided_as_correction audit log entry");
    const newValues = auditEntry!.newValues as { status: string; reason: string } | null;
    assert(newValues?.status === "VOID", `expected the audit log's newValues.status to be VOID, got ${JSON.stringify(newValues)}`);
    console.log("PASS: voiding a sale updates the row, stamps the correction, and audit-logs it.");

    // ============== 2. Empty reason rejected, sale untouched ==============
    const sale2 = await saleService.createSale({
      category: "PRODUCT",
      amountCents: 10000,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      createdAt: DAY_OPEN,
    });
    let reasonRejected = false;
    try {
      await saleService.voidSaleAsCorrection(sale2.id, "   ", employee.id, owner.id);
    } catch (error) {
      reasonRejected = true;
      assert(String(error).includes("reason is required"), `expected a reason-required error, got ${error}`);
    }
    assert(reasonRejected, "expected an empty/whitespace-only reason to be rejected");
    const sale2After = await prisma.sale.findUniqueOrThrow({ where: { id: sale2.id } });
    assert(sale2After.status === "COMPLETED", "expected the sale to remain COMPLETED after a rejected void");
    console.log("PASS: an empty reason is rejected — the sale is left untouched.");

    // ============== 3. Blocked when the day's CashDailyBalance is CONFIRMED ==============
    await prisma.cashDailyBalance.create({
      data: { date: DAY_CONFIRMED, startingBalanceCents: 0, status: "CONFIRMED" },
    });
    const sale3 = await saleService.createSale({
      category: "PRODUCT",
      amountCents: 20000,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      createdAt: DAY_CONFIRMED,
    });
    let blocked = false;
    try {
      await saleService.voidSaleAsCorrection(
        sale3.id,
        "Should be blocked — cash day is confirmed.",
        employee.id,
        owner.id,
      );
    } catch (error) {
      blocked = true;
      assert(String(error).includes("already confirmed"), `expected an already-confirmed error, got ${error}`);
    }
    assert(blocked, "expected the void to be blocked when the day's cash reconciliation is confirmed");
    console.log("PASS: blocked when the day's cash reconciliation is already confirmed.");

    // ============== 4. Allowed once the day is reopened ==============
    await prisma.cashDailyBalance.update({ where: { date: DAY_CONFIRMED }, data: { status: "OPEN" } });
    const voidedAfterReopen = await saleService.voidSaleAsCorrection(
      sale3.id,
      "Day was reopened — void now allowed.",
      employee.id,
      owner.id,
    );
    assert(voidedAfterReopen.status === "VOID", "expected the void to succeed once the day was reopened");
    console.log("PASS: allowed once the reconciliation day is reopened — the block is status-conditional, not blanket.");

    // ============== 5. A sale that's already VOID can't be voided again ==============
    let alreadyVoidRejected = false;
    try {
      await saleService.voidSaleAsCorrection(sale1.id, "Trying to void an already-voided sale.", employee.id, owner.id);
    } catch (error) {
      alreadyVoidRejected = true;
      assert(String(error).includes("COMPLETED"), `expected a COMPLETED-only error, got ${error}`);
    }
    assert(alreadyVoidRejected, "expected a sale that's already VOID to be rejected");
    console.log("PASS: a sale that's already VOID can't be voided again.");

    console.log(
      "\nPASS: sale voiding is real, audit-logged, and correctly blocked by a confirmed reconciliation day.",
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
