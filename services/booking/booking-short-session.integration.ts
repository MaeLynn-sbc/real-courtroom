/**
 * Staff-only 30-minute walk-in slot, flat-priced. Proves, against real
 * rows:
 *   1. A 30-minute staff booking's totalAmountCents equals the
 *      owner-editable shortSessionPriceCents setting, NOT half the
 *      court's hourly rate (₱350/hr × 0.5 = ₱175 — the flat price is
 *      ₱200 by default, a genuinely different number, so this can't
 *      pass by accident).
 *   2. Changing the setting changes the price of the NEXT booking
 *      created — proves it's actually read from settings at booking
 *      time, not a hardcoded constant that happens to match the
 *      default.
 *   3. Settling a 30-minute booking collects exactly the flat price,
 *      correctly reflected in shift cash reconciliation — the
 *      settle-bill path needs no changes for this to work, since it
 *      always reads Booking.totalAmountCents directly.
 *   4. Regression: a 60-minute booking on the same court is
 *      unaffected — still the hourly-rate formula.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { shiftService } from "../shift/shift.service";
import { settingsService } from "../settings/settings.service";

const TEST_DATE = new Date(2031, 3, 9); // Wednesday, distinct from this dir's other fixture dates

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function slot(hour: number, minutes: number): { startAt: Date; endAt: Date } {
  const startAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hour, 0);
  const endAt = new Date(startAt.getTime() + minutes * 60_000);
  return { startAt, endAt };
}

async function cleanUp(courtId: string): Promise<void> {
  const dayStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const bookings = await prisma.booking.findMany({
    where: { courtId, startAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  const ids = bookings.map((b) => b.id);
  await prisma.sale.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null, hourlyRateCents: { not: null } } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });

  await cleanUp(court.id);

  // Save the real settings to restore afterward — this test deliberately
  // changes shortSessionPriceCents mid-run (point 2) and must not leave
  // that change behind for real usage.
  const originalSettings = await settingsService.getOpenPlaySettings();

  const shift = await prisma.shift.create({
    data: { shiftNumber: `SHIFT-SHORTSESSION-${Date.now()}`, employeeId: employee.id, status: "OPEN", openingCashCents: 0 },
  });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

  try {
    // ============== 1. 30-minute booking prices at the flat setting ==============
    assert(
      originalSettings.shortSessionPriceCents !== Math.round((court.hourlyRateCents ?? 0) * 0.5),
      "test fixture invalid: the flat price must differ from half the hourly rate, or this test can't distinguish them",
    );

    const shortSlot = slot(9, 30);
    const shortBooking = await bookingService.createBooking(
      { courtId: court.id, type: "WALK_IN", startAt: shortSlot.startAt, endAt: shortSlot.endAt, guestName: "Short Session Guest A" },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    assert(
      shortBooking.totalAmountCents === originalSettings.shortSessionPriceCents,
      `expected a 30-minute booking to price at the flat shortSessionPriceCents (${originalSettings.shortSessionPriceCents}), got ${shortBooking.totalAmountCents}`,
    );
    const halfHourlyWouldBe = Math.round((court.hourlyRateCents ?? 0) * 0.5);
    assert(
      shortBooking.totalAmountCents !== halfHourlyWouldBe,
      `expected the flat price to differ from half the hourly rate (${halfHourlyWouldBe}) — got the same number, can't tell if this is really flat-priced or coincidentally equal`,
    );
    console.log(
      `PASS: a 30-minute booking prices at the flat ₱${shortBooking.totalAmountCents / 100} setting, not half the hourly rate (would be ₱${halfHourlyWouldBe / 100}).`,
    );

    // ============== 2. Changing the setting changes the next booking's price ==============
    const customPriceCents = 25000; // ₱250 — deliberately different from both the default ₱200 and half-hourly
    await settingsService.setOpenPlaySettings({ ...originalSettings, shortSessionPriceCents: customPriceCents }, owner.id);

    const shortSlot2 = slot(10, 30);
    const shortBooking2 = await bookingService.createBooking(
      { courtId: court.id, type: "WALK_IN", startAt: shortSlot2.startAt, endAt: shortSlot2.endAt, guestName: "Short Session Guest B" },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    assert(
      shortBooking2.totalAmountCents === customPriceCents,
      `expected the booking to price at the just-changed setting (${customPriceCents}), got ${shortBooking2.totalAmountCents} — it's not really reading the setting at booking time`,
    );
    console.log("PASS: changing shortSessionPriceCents changes the price of the next 30-minute booking created — genuinely owner-editable, not a hardcoded constant.");

    // Restore real settings immediately — nothing below this point should
    // run under the test's temporary override.
    await settingsService.setOpenPlaySettings(originalSettings, owner.id);

    // ============== 3. Settling a 30-minute booking collects the flat price ==============
    const expectedBeforeSettle = await shiftService.getExpectedCashForShift(shift);
    await bookingService.settleBooking(
      shortBooking.id,
      "CASH",
      null,
      { employeeId: employee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
      owner.id,
    );
    const expectedAfterSettle = await shiftService.getExpectedCashForShift(shift);
    assert(
      expectedAfterSettle === expectedBeforeSettle + originalSettings.shortSessionPriceCents,
      `expected settling the 30-minute booking to add exactly the flat price (${originalSettings.shortSessionPriceCents}) to expected cash — got a delta of ${expectedAfterSettle - expectedBeforeSettle}`,
    );
    const sale = await prisma.sale.findUnique({ where: { bookingId: shortBooking.id } });
    assert(sale !== null && sale.amountCents === originalSettings.shortSessionPriceCents, "expected the Sale amount to be exactly the flat price, not a fraction of the hourly rate");
    console.log("PASS: settling a 30-minute booking collects exactly the flat price — the settle-bill path needed no changes, it just reads Booking.totalAmountCents as always.");

    // ============== 4. Regression: a 60-minute booking is unaffected ==============
    const hourSlot = slot(13, 60);
    const hourBooking = await bookingService.createBooking(
      { courtId: court.id, type: "WALK_IN", startAt: hourSlot.startAt, endAt: hourSlot.endAt, guestName: "Full Hour Guest" },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    const expectedHourly = Math.round((court.hourlyRateCents ?? 0) * 1);
    assert(
      hourBooking.totalAmountCents === expectedHourly,
      `expected a 60-minute booking to still use the hourly formula (${expectedHourly}), got ${hourBooking.totalAmountCents} — the 30-minute special case must not have leaked into other durations`,
    );
    console.log("PASS: a 60-minute booking still prices via the hourly-rate formula, unaffected by the 30-minute flat-price special case.");

    await cleanUp(court.id);
    await prisma.shift.delete({ where: { id: shift.id } });
    console.log("\nPASS: the 30-minute flat-price walk-in slot is proven against real rows, end to end.");
  } catch (error) {
    await settingsService.setOpenPlaySettings(originalSettings, owner.id).catch(() => {});
    await cleanUp(court.id);
    await prisma.shift.delete({ where: { id: shift.id } }).catch(() => {});
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
