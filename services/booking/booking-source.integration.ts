/**
 * Pre-Phase-8 booking visibility: proves createBooking sets Booking.source
 * explicitly at creation, for both call shapes — this is the live,
 * database-backed counterpart to services/booking/booking-source.test.ts's
 * unit coverage of the historical-backfill resolution logic. That test
 * covers what happens to OLD rows; this one covers what happens to NEW
 * ones, which never touch resolveBookingSource at all.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService, type CreateBookingSaleContext } from "./booking.service";

const TEST_DATE = new Date(2031, 3, 7); // Monday, far enough out not to collide with real usage

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
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-SOURCE-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });
  const baseSaleContext = { employeeId: employee.id, shiftId: shift.id, paymentMethodId: paymentMethod.id };

  await cleanUp(court.id);

  // Staff path: no source override, same as every real staff call site
  // (actions/booking.actions.ts never passes one).
  const staffSlot = slot(10);
  const staffBooking = await bookingService.createBooking(
    { courtId: court.id, type: "HOURLY", startAt: staffSlot.startAt, endAt: staffSlot.endAt, guestName: "Staff Path Guest", paymentMethodId: paymentMethod.id },
    owner.id,
    baseSaleContext as CreateBookingSaleContext,
  );
  console.log(`Staff-path booking source: ${staffBooking.source}`);
  assert(staffBooking.source === "STAFF", `expected a staff-created booking to have source STAFF, got ${staffBooking.source}`);

  // Public path: exactly what createPublicBookingAction passes.
  const publicSlot = slot(13);
  const publicBooking = await bookingService.createBooking(
    { courtId: court.id, type: "HOURLY", startAt: publicSlot.startAt, endAt: publicSlot.endAt, guestName: "Public Path Guest", paymentMethodId: paymentMethod.id },
    owner.id,
    { ...baseSaleContext, source: "WEBSITE" } as CreateBookingSaleContext,
  );
  console.log(`Public-path booking source: ${publicBooking.source}`);
  assert(publicBooking.source === "PUBLIC", `expected a WEBSITE-sourced booking to have source PUBLIC, got ${publicBooking.source}`);

  await cleanUp(court.id);
  console.log("PASS: createBooking sets Booking.source explicitly for both the staff and public paths.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
