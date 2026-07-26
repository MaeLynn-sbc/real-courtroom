/**
 * Fri/Sat walk-in registration fee — Gate 2 review escalation (URGENT,
 * treated as a live revenue-visibility gap, not new scope). Real cash
 * has been collected at the desk since Phase 4/7 (registerWalkIn marks
 * CONFIRMED immediately, "cash paid at the desk") with NO Sale row and
 * NO payment-method attribution — sales reporting hardcoded this
 * bucket to ₱0 with an explicit "not yet built" note.
 *
 * Proves, against real rows, not just that a Sale row exists:
 *   1. registerWalkIn WITH a saleContext creates a real Sale
 *      (category OPEN_PLAY, correct amountCents/paymentMethodId/
 *      employeeId/shiftId, linked via openPlayNightRegistrationId).
 *   2. GCash requires a reference — same validation shape as settleTab.
 *   3. registerWalkIn WITHOUT a saleContext (omitted) creates NO Sale —
 *      proves every pre-existing fixture/test call site across this
 *      codebase that doesn't pass one is byte-for-byte unaffected.
 *   4. registerAndCheckIn's Fri/Sat branch (the "Walk-in, register &
 *      check in" button) ALSO creates the Sale — it's the same
 *      registerWalkIn call underneath, not a second mechanism.
 *   5. openPlaySalesService.getSummary — the actual /dashboard/sales
 *      report — reflects the fee: included in netRevenueCents, broken
 *      out in friSatRegistrationFeeCents/Count, and merged into
 *      byPaymentMethod under the correct payment method. This is the
 *      proof the user explicitly asked for: not that a Sale row exists
 *      in the database, but that the SALES REPORT shows it correctly.
 *   6. The fee amount is read from settings fresh on every call (owner-
 *      editable, not hardcoded) — changing it changes the very next
 *      registration's Sale amount.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlaySalesService } from "./open-play-sales.service";
import { settingsService } from "../settings/settings.service";

const TEST_DATE = new Date(2031, 4, 9); // Friday, May 9 2031 — distinct from other integration fixtures' dates

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

let phoneCounter = 960000;
function nextPhone(): string {
  phoneCounter += 1;
  return String(phoneCounter);
}

async function cleanUpTestSession(): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date: TEST_DATE } });
  if (existing) {
    const registrations = await prisma.openPlayNightRegistration.findMany({
      where: { sessionId: existing.id },
      select: { id: true },
    });
    const ids = registrations.map((r) => r.id);
    const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
    const tabIds = tabs.map((t) => t.id);
    await prisma.sale.deleteMany({ where: { openPlayNightRegistration: { sessionId: existing.id } } });
    await prisma.sale.deleteMany({ where: { playerTabId: { in: tabIds } } });
    await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
    await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
    await prisma.queueEntry.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-TEST-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
    });
  }
  const paymentMethods = await prisma.paymentMethod.findMany({ where: { isActive: true }, take: 2 });
  const cashMethod = paymentMethods[0];
  const gcashMethod = paymentMethods[1] ?? paymentMethods[0];
  assert(cashMethod, "expected at least one active payment method seeded");

  await cleanUpTestSession();

  const originalSettings = await settingsService.getOpenPlaySettings();

  try {
    await openPlayCapacityService.setSessionCapacityOverride(TEST_DATE, 10, owner.id);

    // ============== 1. registerWalkIn WITH saleContext creates a real Sale ==============
    await settingsService.setOpenPlaySettings({ ...originalSettings, friSatRegistrationFeeCents: 15000 }, owner.id);
    const session = await openPlayCapacityService.getOrCreateSessionForDate(TEST_DATE);
    const cashWalkIn = await openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: "Fee Cash Guest", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
      owner.id,
      { method: "CASH", gcashReference: null, paymentMethodId: cashMethod!.id, employeeId: employee.id, shiftId: shift.id },
    );
    const cashSale = await prisma.sale.findUnique({ where: { openPlayNightRegistrationId: cashWalkIn.id } });
    assert(cashSale, "expected a real Sale row linked to the registration via openPlayNightRegistrationId");
    assert(cashSale!.amountCents === 15000, `expected amountCents 15000, got ${cashSale!.amountCents}`);
    assert(cashSale!.category === "OPEN_PLAY", `expected category OPEN_PLAY, got ${cashSale!.category}`);
    assert(cashSale!.paymentMethodId === cashMethod!.id, "expected the Sale's paymentMethodId to match what was submitted");
    assert(cashSale!.employeeId === employee.id, "expected the Sale attributed to the registering employee");
    assert(cashSale!.shiftId === shift.id, "expected the Sale attributed to the open shift");
    console.log("PASS: registerWalkIn with a saleContext creates a real, correctly-attributed Sale row.");

    // ============== 2. GCash requires a reference ==============
    let gcashRejected = false;
    try {
      await openPlayRegistrationService.registerWalkIn(
        session.id,
        { playerName: "No Reference Guest", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
        owner.id,
        { method: "GCASH", gcashReference: null, paymentMethodId: gcashMethod!.id, employeeId: employee.id, shiftId: shift.id },
      );
    } catch (error) {
      gcashRejected = true;
      assert(error instanceof Error && error.message.includes("GCash reference"), `expected a GCash-reference error, got: ${error}`);
    }
    assert(gcashRejected, "expected GCASH without a reference to be rejected");
    console.log("PASS: GCash without a reference number is rejected, same as settleTab.");

    const gcashWalkIn = await openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: "Fee GCash Guest", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
      owner.id,
      { method: "GCASH", gcashReference: "GC-TEST-123", paymentMethodId: gcashMethod!.id, employeeId: employee.id, shiftId: shift.id },
    );
    const gcashSale = await prisma.sale.findUnique({ where: { openPlayNightRegistrationId: gcashWalkIn.id } });
    assert(gcashSale, "expected a real Sale row for the GCash walk-in too");
    assert(gcashSale!.paymentMethodId === gcashMethod!.id, "expected the GCash Sale's paymentMethodId to match");
    console.log("PASS: a valid GCash registration creates its own correctly-attributed Sale.");

    // ============== 3. Omitted saleContext creates NO Sale — backward compatible ==============
    const noContextWalkIn = await openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: "No Context Guest", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    const noSale = await prisma.sale.findUnique({ where: { openPlayNightRegistrationId: noContextWalkIn.id } });
    assert(noSale === null, "expected NO Sale row when saleContext is omitted — every pre-existing test call site must stay unaffected");
    console.log("PASS: omitting saleContext creates no Sale — pre-existing call sites are byte-for-byte unaffected.");

    // ============== 4. registerAndCheckIn's Fri/Sat branch also creates the Sale ==============
    const checkInResult = await openPlayCheckinService.registerAndCheckIn(
      {
        sessionId: session.id,
        saleContext: { method: "CASH", gcashReference: null, paymentMethodId: cashMethod!.id, employeeId: employee.id, shiftId: shift.id },
      },
      { playerName: "Fee Walkin Checkin Guest", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    const checkInSale = await prisma.sale.findUnique({ where: { openPlayNightRegistrationId: checkInResult.registration.id } });
    assert(checkInSale, "expected the 'Walk-in, register & check in' path to also create a Sale — same underlying registerWalkIn call");
    console.log("PASS: registerAndCheckIn's Fri/Sat branch creates the same Sale, not a second mechanism.");

    // ============== 5. The sales report reflects the fee — not just a row in the DB ==============
    const summary = await openPlaySalesService.getSummary(TEST_DATE, TEST_DATE);
    console.log(`Summary: friSatRegistrationFeeCents=${summary.friSatRegistrationFeeCents}, count=${summary.friSatRegistrationFeeCount}, netRevenueCents=${summary.netRevenueCents}`);
    // 3 Sales at 15000 each so far (cash, gcash, walk-in-checkin) = 45000.
    assert(summary.friSatRegistrationFeeCents === 45000, `expected friSatRegistrationFeeCents 45000, got ${summary.friSatRegistrationFeeCents}`);
    assert(summary.friSatRegistrationFeeCount === 3, `expected friSatRegistrationFeeCount 3, got ${summary.friSatRegistrationFeeCount}`);
    assert(summary.netRevenueCents >= 45000, `expected netRevenueCents to include the registration fee, got ${summary.netRevenueCents}`);
    const cashRow = summary.byPaymentMethod.find((row) => row.paymentMethodId === cashMethod!.id);
    assert(cashRow, "expected the cash payment method to appear in byPaymentMethod");
    assert(cashRow!.amountCents >= 30000, `expected at least 2 cash registrations (30000) attributed to ${cashMethod!.label}, got ${cashRow!.amountCents}`);
    console.log("PASS: the sales report (openPlaySalesService.getSummary) shows the fee, broken out by payment method, not just a database row.");

    // ============== 6. The fee amount is owner-editable, read fresh every call ==============
    await settingsService.setOpenPlaySettings({ ...originalSettings, friSatRegistrationFeeCents: 20000 }, owner.id);
    const higherFeeWalkIn = await openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: "Higher Fee Guest", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
      owner.id,
      { method: "CASH", gcashReference: null, paymentMethodId: cashMethod!.id, employeeId: employee.id, shiftId: shift.id },
    );
    const higherFeeSale = await prisma.sale.findUnique({ where: { openPlayNightRegistrationId: higherFeeWalkIn.id } });
    assert(higherFeeSale, "expected a Sale for the higher-fee registration");
    assert(higherFeeSale!.amountCents === 20000, `expected the NEW fee amount 20000 to apply immediately, got ${higherFeeSale!.amountCents}`);
    console.log("PASS: the registration fee is owner-editable and read fresh on every call, not cached or hardcoded.");

    await cleanUpTestSession();
    console.log("\nPASS: Fri/Sat walk-in registration fee is now a real, correctly-attributed, reported Sale.");
  } finally {
    await settingsService.setOpenPlaySettings(originalSettings, owner.id);
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanUpTestSession();
  process.exit(1);
});
