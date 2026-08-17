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
 *   6. Regression (audit 2026-08-16): a sale rung up at 1:30 AM belongs to
 *      the PREVIOUS business day (rollover hour 3) — the confirmed-day
 *      block must key off that day, not createdAt's calendar date.
 *   7. Regression (audit 2026-08-16): an Open Play tab settled the NEXT
 *      day belongs to the night it was opened (Sale.businessDate is taken
 *      from PlayerTab.date, not from createdAt) — same block, same
 *      reasoning, and a case the rollover hour alone can't explain.
 *
 * Cases 6-7 both FAILED before the fix. assertReconciliationDayNotConfirmed
 * derived the day from sale.createdAt, while every reconciliation sum keys
 * off sale.businessDate — so a void could silently rewrite the total of a
 * day staff had already signed off on, which is the exact invariant this
 * block exists to protect.
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

// Cases 6-7: the business day the sale really belongs to (what
// CashDailyBalance.date holds — always midnight-normalized) deliberately
// differs from its createdAt calendar date.
const NIGHT_ROLLOVER = new Date(2021, 5, 14);
const SALE_AFTER_MIDNIGHT = new Date(2021, 5, 15, 1, 30, 0, 0);
const NIGHT_TAB = new Date(2021, 5, 16);
const TAB_SETTLED_NEXT_DAY = new Date(2021, 5, 17, 14, 0, 0, 0);

// Cases 1-5 are about a day's CONFIRMED/OPEN status, NOT about the
// rollover boundary — so their sales are stamped at midday, where
// createdAt's calendar date and the derived businessDate agree. Left at
// bare midnight these fixtures silently landed on the PREVIOUS business
// day (rollover hour 3), which is the very confusion cases 6-7 pin down.
function atMidday(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

async function cleanUpDates(): Promise<void> {
  await prisma.cashDailyBalance.deleteMany({
    where: { date: { in: [DAY_CONFIRMED, DAY_OPEN, NIGHT_ROLLOVER, NIGHT_TAB] } },
  });
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
      createdAt: atMidday(DAY_OPEN),
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
      createdAt: atMidday(DAY_OPEN),
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
      createdAt: atMidday(DAY_CONFIRMED),
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

    // ============== 6. Rollover boundary — a 1:30 AM sale belongs to the PREVIOUS business day ==============
    // The night of Jun 14 is confirmed and signed off. A sale rung up at
    // 1:30 AM on Jun 15 is still part of THAT night's takings (rollover
    // hour 3), and getCashSalesForDate counts it under Jun 14. Jun 15
    // deliberately has no balance row at all, so a guard that keys off
    // createdAt's calendar date finds nothing and waves the void through.
    await prisma.cashDailyBalance.create({
      data: { date: NIGHT_ROLLOVER, startingBalanceCents: 0, status: "CONFIRMED" },
    });
    const saleAfterMidnight = await saleService.createSale({
      category: "PRODUCT",
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
      await saleService.voidSaleAsCorrection(
        saleAfterMidnight.id,
        "Should be blocked — this sale is counted in Jun 14's confirmed cash.",
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

    // ============== 7. An Open Play tab settled the next day belongs to the night it was opened ==============
    // Not a rollover-hour case at all: createSale takes businessDate
    // straight from PlayerTab.date, so a tab opened on the night of
    // Jun 16 and settled at 2 PM on Jun 17 is counted under Jun 16 —
    // a full 14 hours past any rollover boundary.
    await prisma.cashDailyBalance.create({
      data: { date: NIGHT_TAB, startingBalanceCents: 0, status: "CONFIRMED" },
    });
    const registration = await prisma.openPlayNightRegistration.create({
      data: {
        date: NIGHT_TAB,
        playerName: "Regression Fixture Player",
        phone: "09170000000",
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
      await saleService.voidSaleAsCorrection(
        tabSale.id,
        "Should be blocked — this tab is counted in Jun 16's confirmed cash.",
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
      "\nPASS: sale voiding is real, audit-logged, and correctly blocked by a confirmed reconciliation day.",
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
