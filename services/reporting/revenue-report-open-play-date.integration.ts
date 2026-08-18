/**
 * Owner-reported incident (2026-08-08): the Reports page's revenue
 * summary (getRevenueReport, "Cash collected"/"GCash collected"/Regular
 * open play/Unli play cards) scoped every Open Play Sale by raw
 * createdAt — the same bug already fixed on the dashboard's Today's
 * Revenue panel (services/sales/sale-summary-open-play-date.integration.ts),
 * but this is a separate, duplicate implementation
 * (reportingService.getOpenPlaySplit) that never got the same fix. A
 * customer's Aug 6 tab, settled just after midnight, was still showing
 * up in an Aug 7 report the owner needed to send to co-owners.
 *
 * Proves, against real rows:
 *   1. An Open Play sale (regular and unli) for YESTERDAY's session,
 *      settled just after midnight today, is excluded from a report
 *      scoped to today — both in the category split (getOpenPlaySplit)
 *      and in the overall Cash/GCash collected totals (getRevenueReport
 *      itself), which used to disagree with the category split for
 *      exactly this reason.
 *   2. A same-night settlement still counts normally in both.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { resolveDateRange } from "../analytics/date-range";
import { reportingService } from "./reporting.service";
import { saleService } from "../sales/sale.service";

// rolloverHour stated explicitly (it used to default to 0). These
// fixtures are built on literal midnight (setHours(0,0,0,0)), so 0 is
// the assumption this test is actually written against — not the
// venue's real rollover of 3. Preserved deliberately rather than
// "corrected": switching to 3 would change what "TODAY" means when the
// suite runs before 3am, making these time-of-day dependent.
const TEST_ROLLOVER_HOUR = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const MARKER = `revenue-report-open-play-date-test-${Date.now()}`;

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
    const before = await reportingService.getRevenueReport(resolveDateRange("TODAY", undefined, undefined, TEST_ROLLOVER_HOUR));

    // ============== 1. Regular (PlayerTab) — session was yesterday, settled today ==============
    const staleRegistration = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: null,
        date: yesterday,
        playerName: `${MARKER} regular`,
        phone: "09170000101",
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
        phone: "09170000102",
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

    const afterStale = await reportingService.getRevenueReport(resolveDateRange("TODAY", undefined, undefined, TEST_ROLLOVER_HOUR));
    assert(
      afterStale.openPlayAmountCents === before.openPlayAmountCents,
      `expected today's Open Play total unchanged by yesterday's late-settled tabs, went from ${before.openPlayAmountCents} to ${afterStale.openPlayAmountCents}`,
    );
    assert(
      afterStale.cashAmountCents === before.cashAmountCents,
      `expected today's Cash collected unchanged by yesterday's late-settled tabs, went from ${before.cashAmountCents} to ${afterStale.cashAmountCents}`,
    );
    assert(
      afterStale.totalAmountCents === before.totalAmountCents,
      `expected today's total revenue unchanged, went from ${before.totalAmountCents} to ${afterStale.totalAmountCents}`,
    );
    console.log(
      "PASS: an Open Play sale (regular and unli) for YESTERDAY's session, settled just after midnight today, is excluded from today's revenue report — category split AND Cash collected agree.",
    );

    // ============== 3. Same-night settlement (normal case) still counts ==============
    const freshRegistration = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: null,
        date: today,
        playerName: `${MARKER} fresh`,
        phone: "09170000103",
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

    const afterFresh = await reportingService.getRevenueReport(resolveDateRange("TODAY", undefined, undefined, TEST_ROLLOVER_HOUR));
    assert(
      afterFresh.openPlayAmountCents === afterStale.openPlayAmountCents + 7000,
      `expected today's Open Play total to increase by 7000 for the same-night settlement, went from ${afterStale.openPlayAmountCents} to ${afterFresh.openPlayAmountCents}`,
    );
    assert(
      afterFresh.cashAmountCents === afterStale.cashAmountCents + 7000,
      `expected today's Cash collected to increase by exactly 7000 too, went from ${afterStale.cashAmountCents} to ${afterFresh.cashAmountCents}`,
    );
    console.log("PASS: a same-night Open Play settlement still counts normally in both the category split and Cash collected.");

    console.log("\nPASS: revenue report is scoped by Open Play session date, not settlement timestamp.");
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
