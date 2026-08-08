/**
 * Owner-reported incident (2026-08-08): after fixing the Reports
 * summary (getRevenueReport) to scope Open Play sales by session date
 * instead of raw createdAt, the owner asked to extend the same fix to
 * the separate "Sales by category" / "Sales by payment method"
 * drill-down reports (getSalesByCategoryReport/
 * getSalesByPaymentMethodReport) — same underlying bug, same class of
 * report, previously left unfixed since they weren't the specific
 * screen first reported. Both now share reportingService's own
 * dateAwareSaleWhere helper, the same one getRevenueReport uses.
 *
 * Proves, against real rows:
 *   1. An Open Play sale (regular and unli) for YESTERDAY's session,
 *      settled just after midnight today, is excluded from both
 *      reports when scoped to today.
 *   2. A same-night settlement still counts normally in both.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { resolveDateRange } from "../analytics/date-range";
import { reportingService } from "./reporting.service";
import { saleService } from "../sales/sale.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const MARKER = `sales-by-category-payment-open-play-date-test-${Date.now()}`;

function openPlayTotal(rows: { category: string; amountCents: number }[]): number {
  return rows.find((row) => row.category === "OPEN_PLAY")?.amountCents ?? 0;
}

function cashTotal(rows: { paymentMethodLabel: string; amountCents: number }[]): number {
  return rows.find((row) => row.paymentMethodLabel.toUpperCase().includes("CASH") && !row.paymentMethodLabel.toUpperCase().includes("GCASH"))
    ?.amountCents ?? 0;
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const shift = await prisma.shift.create({
    data: { shiftNumber: `SHIFT-TEST-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
  });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  try {
    const beforeByCategory = openPlayTotal(await reportingService.getSalesByCategoryReport(resolveDateRange("TODAY")));
    const beforeByMethod = cashTotal(await reportingService.getSalesByPaymentMethodReport(resolveDateRange("TODAY")));

    // ============== 1. Regular (PlayerTab) — session was yesterday, settled today ==============
    const staleRegistration = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: null,
        date: yesterday,
        playerName: `${MARKER} regular`,
        phone: "09170000201",
        skillLevel: "INTERMEDIATE",
        source: "WEBSITE",
        status: "CONFIRMED",
      },
    });
    const staleTab = await prisma.playerTab.create({
      data: {
        date: yesterday,
        sessionId: null,
        registrationId: staleRegistration.id,
        playerName: staleRegistration.playerName,
        gameRateCents: 3500,
        status: "SETTLED",
        settledAt: new Date(),
        settledVia: "CASH",
      },
    });
    await saleService.createSale({
      category: "OPEN_PLAY",
      amountCents: 10500,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      playerTabId: staleTab.id,
    });

    // ============== 2. Unli (OpenPlayNightRegistration) — session was yesterday, settled today ==============
    const staleUnliRegistration = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: null,
        date: yesterday,
        playerName: `${MARKER} unli`,
        phone: "09170000202",
        skillLevel: "INTERMEDIATE",
        source: "WEBSITE",
        status: "CONFIRMED",
      },
    });
    await saleService.createSale({
      category: "OPEN_PLAY",
      amountCents: 15000,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      openPlayNightRegistrationId: staleUnliRegistration.id,
    });

    const afterStaleByCategory = openPlayTotal(await reportingService.getSalesByCategoryReport(resolveDateRange("TODAY")));
    const afterStaleByMethod = cashTotal(await reportingService.getSalesByPaymentMethodReport(resolveDateRange("TODAY")));
    assert(
      afterStaleByCategory === beforeByCategory,
      `expected Sales by category's OPEN_PLAY total unchanged by yesterday's late-settled tabs, went from ${beforeByCategory} to ${afterStaleByCategory}`,
    );
    assert(
      afterStaleByMethod === beforeByMethod,
      `expected Sales by payment method's Cash total unchanged by yesterday's late-settled tabs, went from ${beforeByMethod} to ${afterStaleByMethod}`,
    );
    console.log(
      "PASS: an Open Play sale (regular and unli) for YESTERDAY's session, settled just after midnight today, is excluded from both Sales by category and Sales by payment method.",
    );

    // ============== 3. Same-night settlement (normal case) still counts ==============
    const freshRegistration = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: null,
        date: today,
        playerName: `${MARKER} fresh`,
        phone: "09170000203",
        skillLevel: "INTERMEDIATE",
        source: "WEBSITE",
        status: "CONFIRMED",
      },
    });
    const freshTab = await prisma.playerTab.create({
      data: {
        date: today,
        sessionId: null,
        registrationId: freshRegistration.id,
        playerName: freshRegistration.playerName,
        gameRateCents: 3500,
        status: "SETTLED",
        settledAt: new Date(),
        settledVia: "CASH",
      },
    });
    await saleService.createSale({
      category: "OPEN_PLAY",
      amountCents: 7000,
      paymentMethodId: cashMethod.id,
      employeeId: employee.id,
      shiftId: shift.id,
      playerTabId: freshTab.id,
    });

    const afterFreshByCategory = openPlayTotal(await reportingService.getSalesByCategoryReport(resolveDateRange("TODAY")));
    const afterFreshByMethod = cashTotal(await reportingService.getSalesByPaymentMethodReport(resolveDateRange("TODAY")));
    assert(
      afterFreshByCategory === afterStaleByCategory + 7000,
      `expected Sales by category's OPEN_PLAY total to increase by exactly 7000, went from ${afterStaleByCategory} to ${afterFreshByCategory}`,
    );
    assert(
      afterFreshByMethod === afterStaleByMethod + 7000,
      `expected Sales by payment method's Cash total to increase by exactly 7000, went from ${afterStaleByMethod} to ${afterFreshByMethod}`,
    );
    console.log("PASS: a same-night Open Play settlement still counts normally in both reports.");

    console.log("\nPASS: Sales by category and Sales by payment method are scoped by Open Play session date, not settlement timestamp.");
  } finally {
    await prisma.sale.deleteMany({ where: { shiftId: shift.id } });
    await prisma.playerTab.deleteMany({ where: { playerName: { startsWith: MARKER } } });
    await prisma.openPlayNightRegistration.deleteMany({ where: { playerName: { startsWith: MARKER } } });
    await prisma.shift.delete({ where: { id: shift.id } });
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
