/**
 * Reported live: cash that comes in outside every modelled revenue flow
 * (a booking, a product sale, a settled tab, ...) had nowhere to go —
 * SaleCategory.OTHER existed in the schema (with description/notes
 * fields explicitly documented for "categories with no source row") but
 * nothing ever created one, so staff recorded it on paper, invisible to
 * every report and shift reconciliation.
 *
 * Proves, against real rows:
 *   1. A manual sale creates a real, correctly-attributed Sale row
 *      (category OTHER, no linked source record, real employee/shift).
 *   2. It appears in listManualSalesForShift — the "distinguishable,
 *      not blended in" list the shift screen shows.
 *   3. A CASH manual sale is correctly included in getCashSalesForShift
 *      — the exact number shift close compares the physical count
 *      against — so it actually reconciles, not just exists as a row.
 *   4. It is also included in the plain getSalesForShift total (the
 *      shift's overall revenue), alongside any other sale.
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

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const shift = await prisma.shift.create({
    data: { shiftNumber: `SHIFT-TEST-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
  });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

  try {
    const before = await saleService.getSalesForShift(shift.id);
    const cashBefore = await saleService.getCashSalesForShift(shift.id);

    // ============== 1. Creates a real, correctly-attributed Sale row ==============
    const sale = await saleService.createSale({
      category: "OTHER",
      amountCents: 50000,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      description: "Manual sale",
      notes: "Fri/Sat daytime open play, paper-recorded 2026-07-31",
    });
    await saleService.logSaleCreated(sale, owner.id);

    assert(sale.category === "OTHER", `expected category OTHER, got ${sale.category}`);
    assert(sale.amountCents === 50000, `expected amountCents 50000, got ${sale.amountCents}`);
    assert(sale.employeeId === employee.id, "expected the Sale attributed to the recording employee");
    assert(sale.shiftId === shift.id, "expected the Sale attributed to the current shift");
    assert(
      sale.bookingId === null &&
        sale.membershipId === null &&
        sale.equipmentRentalId === null &&
        sale.lockerRentalId === null &&
        sale.tournamentRegistrationId === null &&
        sale.productId === null &&
        sale.playerTabId === null &&
        sale.openPlayNightRegistrationId === null,
      "expected no linked source record on a manual sale",
    );
    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "Sale", entityId: sale.id, action: "sale.created" },
    });
    assert(auditEntry, "expected a sale.created audit log entry");
    console.log("PASS: a manual sale creates a real, correctly-attributed Sale row with no linked source record.");

    // ============== 2. Appears in listManualSalesForShift ==============
    const manualSales = await saleService.listManualSalesForShift(shift.id);
    assert(
      manualSales.some((s) => s.id === sale.id),
      "expected the manual sale to appear in listManualSalesForShift",
    );
    console.log("PASS: the manual sale is visibly distinguishable via listManualSalesForShift, not blended in.");

    // ============== 3. Correctly included in getCashSalesForShift (the shift-close reconciliation number) ==============
    const cashAfter = await saleService.getCashSalesForShift(shift.id);
    assert(
      cashAfter.totalAmountCents === cashBefore.totalAmountCents + 50000,
      `expected cash total to increase by 50000, went from ${cashBefore.totalAmountCents} to ${cashAfter.totalAmountCents}`,
    );
    console.log("PASS: a CASH manual sale is included in getCashSalesForShift — it actually reconciles at shift close.");

    // ============== 4. Included in the shift's overall sales total ==============
    const after = await saleService.getSalesForShift(shift.id);
    assert(
      after.totalAmountCents === before.totalAmountCents + 50000,
      `expected the shift total to increase by 50000, went from ${before.totalAmountCents} to ${after.totalAmountCents}`,
    );
    assert(after.transactionCount === before.transactionCount + 1, "expected the transaction count to increase by 1");
    console.log("PASS: the manual sale is included in the shift's overall revenue total.");

    console.log("\nPASS: manual sale entry is a real, reconciling Sale — no longer a paper-only record.");
  } finally {
    await prisma.sale.deleteMany({ where: { shiftId: shift.id } });
    await prisma.shift.delete({ where: { id: shift.id } });
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
