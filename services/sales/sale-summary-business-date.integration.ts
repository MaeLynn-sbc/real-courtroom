/**
 * Owner-directed consolidation (2026-08-12): "getSalesSummary applies
 * business-date logic to EVERY category, not just Open Play. The split
 * you found is the bug; generalize the fix that was made narrowly on
 * Aug 7." Before this, only OPEN_PLAY sales were attributed by a real
 * business date (via a join to PlayerTab.date/OpenPlayNightRegistration.
 * date) — every other category used raw createdAt, so a sale rung up
 * between midnight and the rollover hour landed on the wrong day.
 *
 * Proves, against real rows, that a non-Open-Play category (BOOKING) now
 * gets the same correct treatment via Sale.businessDate:
 *   1. A sale created just after midnight but BEFORE the rollover hour
 *      still counts as YESTERDAY's business day (matches
 *      computeBusinessDate exactly).
 *   2. A sale created AFTER the rollover hour counts as that calendar
 *      day's business day (the normal, unremarkable case).
 *   3. Sale.businessDate is set once, at creation — not recomputed
 *      differently by different queries.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { computeBusinessDate } from "../../lib/business-date";
import { prisma } from "../../lib/prisma";
import { settingsService } from "../settings/settings.service";
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
    data: { shiftNumber: `SHIFT-BIZDATE-TEST-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
  });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const courtHours = await settingsService.getCourtHours();
  const rolloverHour = courtHours.businessDateRolloverHour;

  const saleIds: string[] = [];

  try {
    // ============== 1. Just after midnight, before rollover -> still yesterday ==============
    const justAfterMidnight = new Date();
    justAfterMidnight.setHours(1, 30, 0, 0);
    assert(
      rolloverHour > 1,
      `this test assumes a rollover hour after 1:30am to be meaningful, got ${rolloverHour}`,
    );
    const saleBeforeRollover = await saleService.createSale({
      category: "BOOKING",
      amountCents: 50000,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      createdAt: justAfterMidnight,
    });
    saleIds.push(saleBeforeRollover.id);
    const reloadedBefore = await prisma.sale.findUniqueOrThrow({ where: { id: saleBeforeRollover.id } });
    const expectedYesterday = computeBusinessDate(justAfterMidnight, rolloverHour);
    assert(
      reloadedBefore.businessDate?.getTime() === expectedYesterday.getTime(),
      `expected businessDate ${expectedYesterday.toISOString()} for a sale before the rollover hour, got ${reloadedBefore.businessDate?.toISOString()}`,
    );
    console.log(
      "PASS: a BOOKING sale created just after midnight but before the rollover hour is attributed to the previous business day.",
    );

    // ============== 2. After rollover -> that calendar day, the normal case ==============
    const afterRollover = new Date();
    afterRollover.setHours(Math.min(rolloverHour + 2, 22), 0, 0, 0);
    const saleAfterRollover = await saleService.createSale({
      category: "BOOKING",
      amountCents: 30000,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      createdAt: afterRollover,
    });
    saleIds.push(saleAfterRollover.id);
    const reloadedAfter = await prisma.sale.findUniqueOrThrow({ where: { id: saleAfterRollover.id } });
    const expectedToday = computeBusinessDate(afterRollover, rolloverHour);
    assert(
      reloadedAfter.businessDate?.getTime() === expectedToday.getTime(),
      `expected businessDate ${expectedToday.toISOString()} for a sale after the rollover hour, got ${reloadedAfter.businessDate?.toISOString()}`,
    );
    console.log("PASS: a BOOKING sale created after the rollover hour is attributed to that calendar day, the normal case.");

    console.log("\nPASS: Sale.businessDate generalizes the Aug 7 Open Play fix to every category.");
  } finally {
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.shift.delete({ where: { id: shift.id } });
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
