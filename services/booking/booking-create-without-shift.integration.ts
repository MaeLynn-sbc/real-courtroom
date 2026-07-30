/**
 * Owner-creates-without-shift exemption. Proves, against real rows:
 *   1. createBooking succeeds with saleContext.shiftId undefined (the
 *      new Owner-without-shift path) — booking is created CONFIRMED,
 *      no Sale, exactly like the normal staff-with-shift path, since
 *      creation never carries money regardless of which path it took.
 *   2. Regression: the WEBSITE pay-at-venue-by-default path (which
 *      DOES pass paymentMethodId, and therefore must have a real
 *      shiftId) is unaffected — still gets an immediate Sale.
 *   3. The invariant this exemption must never violate: passing
 *      paymentMethodId WITHOUT a shiftId is rejected outright, not
 *      silently allowed to reach Sale creation with an undefined
 *      shiftId. Proven failing-first against the pre-fix code (this
 *      exact combination used to be impossible to construct at all,
 *      since shiftId was required — now that it's optional, this
 *      guard is what keeps the combination from producing a broken
 *      Sale attempt instead of a clear rejection).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService, type CreateBookingSaleContext } from "./booking.service";

const TEST_DATE = new Date(2031, 4, 21); // Wednesday, distinct from other fixture dates

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function slot(hour: number): { startAt: Date; endAt: Date } {
  const startAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hour, 0);
  const endAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hour + 1, 0);
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
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });

  await cleanUp(court.id);

  try {
    // ============== 1. Creation with no shift succeeds, no Sale ==============
    const noShiftSlot = slot(9);
    const noShiftBooking = await bookingService.createBooking(
      { courtId: court.id, type: "HOURLY", startAt: noShiftSlot.startAt, endAt: noShiftSlot.endAt, guestName: "No Shift Owner Guest" },
      owner.id,
      { employeeId: employee.id, shiftId: undefined },
    );
    assert(noShiftBooking.status === "CONFIRMED", "expected the booking to be CONFIRMED even with no shift");
    const withSale = await prisma.booking.findUniqueOrThrow({ where: { id: noShiftBooking.id }, include: { sale: true } });
    assert(withSale.sale === null, "expected NO Sale for a booking created without a shift");
    console.log("PASS: createBooking succeeds with no open shift — booking confirmed, no Sale, exactly as intended.");

    // ============== 2. Regression: WEBSITE path still works, real shift ==============
    const websiteUser = await prisma.user.findFirstOrThrow({ where: { email: "website@thecourtroom.local" } });
    const websiteEmployee = await prisma.employee.findFirstOrThrow({
      where: { userId: websiteUser.id },
    });
    const websiteShift = await prisma.shift.findFirstOrThrow({
      where: { employeeId: websiteEmployee.id, status: "OPEN" },
    });
    const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
    const websiteSlot = slot(11);
    const websiteBooking = await bookingService.createBooking(
      { courtId: court.id, type: "HOURLY", startAt: websiteSlot.startAt, endAt: websiteSlot.endAt, guestName: "Website Regression Guest" },
      owner.id,
      {
        employeeId: websiteEmployee.id,
        shiftId: websiteShift.id,
        paymentMethodId: cashMethod.id,
        source: "WEBSITE",
      } as CreateBookingSaleContext,
    );
    const websiteWithSale = await prisma.booking.findUniqueOrThrow({ where: { id: websiteBooking.id }, include: { sale: true } });
    assert(websiteWithSale.sale !== null, "expected the WEBSITE pay-at-venue path to still get an immediate Sale, unaffected");
    console.log("PASS: WEBSITE pay-at-venue-by-default path unaffected — still gets an immediate Sale with a real shift.");

    // ============== 3. paymentMethodId WITHOUT shiftId is rejected outright ==============
    const brokenSlot = slot(13);
    let rejected = false;
    try {
      await bookingService.createBooking(
        { courtId: court.id, type: "HOURLY", startAt: brokenSlot.startAt, endAt: brokenSlot.endAt, guestName: "Broken Combo Guest" },
        owner.id,
        { employeeId: employee.id, shiftId: undefined, paymentMethodId: cashMethod.id } as CreateBookingSaleContext,
      );
    } catch (error) {
      rejected = error instanceof Error && error.message.includes("no shift is open");
    }
    assert(rejected, "expected createBooking to reject paymentMethodId without a shiftId, not silently proceed");
    const brokenBookingCount = await prisma.booking.count({
      where: { courtId: court.id, startAt: brokenSlot.startAt, guestName: "Broken Combo Guest" },
    });
    assert(brokenBookingCount === 0, "expected no booking to be left behind by the rejected attempt (transaction rolled back)");
    console.log("PASS: paymentMethodId without a shiftId is rejected outright — no broken Sale attempt, no orphaned booking.");

    await cleanUp(court.id);
    console.log("\nPASS: Owner-creates-without-shift proven against real rows.");
  } catch (error) {
    await cleanUp(court.id);
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
