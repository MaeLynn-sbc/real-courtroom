/**
 * Pre-Phase-8 booking visibility, item 4: listBookings gained a source
 * filter and a createdAt sort option, both additive. This proves the
 * default ordering is untouched (still startAt asc) and that opting into
 * sortBy: "createdAt" or a source filter actually changes what comes back.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService, type CreateBookingSaleContext } from "./booking.service";

const TEST_DATE = new Date(2031, 3, 8); // Tuesday, far enough out not to collide with real usage

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
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-LISTFILTER-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });
  const baseSaleContext = { employeeId: employee.id, shiftId: shift.id, paymentMethodId: paymentMethod.id };

  await cleanUp(court.id);

  // Created in reverse of startAt order: the LATER slot (14:00) is
  // created FIRST, so startAt order and createdAt order disagree —
  // otherwise a bug that ignores sortBy entirely could still pass.
  const laterSlot = slot(14);
  const laterBooking = await bookingService.createBooking(
    { courtId: court.id, type: "HOURLY", startAt: laterSlot.startAt, endAt: laterSlot.endAt, guestName: "Later Slot Guest" },
    owner.id,
    baseSaleContext as CreateBookingSaleContext,
  );
  const earlierSlot = slot(9);
  const earlierBooking = await bookingService.createBooking(
    { courtId: court.id, type: "HOURLY", startAt: earlierSlot.startAt, endAt: earlierSlot.endAt, guestName: "Earlier Slot Guest" },
    owner.id,
    { ...baseSaleContext, source: "WEBSITE" } as CreateBookingSaleContext,
  );

  const defaultOrder = await bookingService.listBookings({ date: TEST_DATE, courtId: court.id });
  assert(
    defaultOrder[0]?.id === earlierBooking.id && defaultOrder[1]?.id === laterBooking.id,
    "expected the default (unset sortBy) order to stay startAt asc",
  );
  console.log("PASS: default listBookings order is unchanged (startAt asc).");

  const byCreatedAt = await bookingService.listBookings({ date: TEST_DATE, courtId: court.id, sortBy: "createdAt" });
  assert(
    byCreatedAt[0]?.id === earlierBooking.id && byCreatedAt[1]?.id === laterBooking.id,
    "expected sortBy: createdAt to return the later-slot booking last (it was created second)",
  );
  console.log("PASS: sortBy: 'createdAt' orders by creation time, not startAt.");

  const staffOnly = await bookingService.listBookings({ date: TEST_DATE, courtId: court.id, source: "STAFF" });
  assert(
    staffOnly.length === 1 && staffOnly[0]?.id === laterBooking.id,
    "expected source: 'STAFF' to return only the staff-created booking",
  );
  const publicOnly = await bookingService.listBookings({ date: TEST_DATE, courtId: court.id, source: "PUBLIC" });
  assert(
    publicOnly.length === 1 && publicOnly[0]?.id === earlierBooking.id,
    "expected source: 'PUBLIC' to return only the WEBSITE-sourced booking",
  );
  console.log("PASS: source filter narrows results to the requested BookingSource.");

  await cleanUp(court.id);
  console.log("PASS: listBookings' createdAt sort and source filter both work without changing the default.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
