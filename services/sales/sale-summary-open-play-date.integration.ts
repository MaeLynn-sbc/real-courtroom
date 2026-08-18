/**
 * Reported live (2026-08-07): an Open Play tab settled just after midnight
 * — closing out the PREVIOUS night's session — was showing up in TODAY's
 * revenue panel, even though it was already accounted for as part of last
 * night's count. getSalesSummary scoped every Sale purely by
 * Sale.createdAt (when it was rung up), never by which night's session it
 * was actually for — PlayerTab.date / OpenPlayNightRegistration.date hold
 * that already.
 *
 * Proves, against real rows:
 *   1. A PlayerTab-settled ("regular") Open Play sale dated YESTERDAY but
 *      rung up (createdAt) TODAY does NOT appear in today's summary.
 *   2. Same for an OpenPlayNightRegistration-linked ("unli") sale.
 *   3. A same-night settlement (session date == createdAt date, the normal
 *      case) still appears in today's summary — the fix doesn't just
 *      exclude Open Play entirely.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { resolveDateRange } from "../analytics/date-range";
import { saleService } from "./sale.service";

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

const MARKER = `open-play-date-test-${Date.now()}`;

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
    const before = await saleService.getSalesSummary(resolveDateRange("TODAY", undefined, undefined, TEST_ROLLOVER_HOUR));

    // ============== 1. Regular (PlayerTab) — session was yesterday, settled today ==============
    const staleRegistration = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: null,
        date: yesterday,
        playerName: `${MARKER} regular`,
        phone: "09170000001",
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
        phone: "09170000002",
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

    const afterStale = await saleService.getSalesSummary(resolveDateRange("TODAY", undefined, undefined, TEST_ROLLOVER_HOUR));
    assert(
      afterStale.totalAmountCents === before.totalAmountCents,
      `expected today's total unchanged by yesterday's late-settled tabs, went from ${before.totalAmountCents} to ${afterStale.totalAmountCents}`,
    );
    assert(
      afterStale.transactionCount === before.transactionCount,
      `expected today's transaction count unchanged, went from ${before.transactionCount} to ${afterStale.transactionCount}`,
    );
    const staleRegularCategory = afterStale.byCategory.find((c) => c.category === "OPEN_PLAY_REGULAR");
    const staleUnliCategory = afterStale.byCategory.find((c) => c.category === "OPEN_PLAY_UNLI");
    const beforeRegularAmount =
      before.byCategory.find((c) => c.category === "OPEN_PLAY_REGULAR")?.amountCents ?? 0;
    const beforeUnliAmount = before.byCategory.find((c) => c.category === "OPEN_PLAY_UNLI")?.amountCents ?? 0;
    assert(
      (staleRegularCategory?.amountCents ?? 0) === beforeRegularAmount,
      "expected OPEN_PLAY_REGULAR category total unchanged by yesterday's late-settled tab",
    );
    assert(
      (staleUnliCategory?.amountCents ?? 0) === beforeUnliAmount,
      "expected OPEN_PLAY_UNLI category total unchanged by yesterday's late-settled registration",
    );
    console.log(
      "PASS: an Open Play sale (regular and unli) for YESTERDAY's session, settled just after midnight today, is excluded from today's revenue.",
    );

    // ============== 3. Same-night settlement (normal case) still counts ==============
    const freshRegistration = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: null,
        date: today,
        playerName: `${MARKER} fresh`,
        phone: "09170000003",
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

    const afterFresh = await saleService.getSalesSummary(resolveDateRange("TODAY", undefined, undefined, TEST_ROLLOVER_HOUR));
    assert(
      afterFresh.totalAmountCents === afterStale.totalAmountCents + 7000,
      `expected today's total to increase by 7000 for the same-night settlement, went from ${afterStale.totalAmountCents} to ${afterFresh.totalAmountCents}`,
    );
    console.log("PASS: a same-night Open Play settlement still counts in today's revenue — normal case unaffected.");

    console.log("\nPASS: today's revenue is scoped by Open Play session date, not settlement timestamp.");
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
