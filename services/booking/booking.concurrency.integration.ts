/**
 * Hardening phase (BUILD-SPEC.md §0/§15 process rule — a failing test
 * before every fix, then confirmed passing after). Covers item 2 of the
 * hardening-phase follow-up: booking.service.ts underpins Phase 8 and was
 * excluded from the original six-item audit as "already reviewed" — but
 * that review predated every concurrency bug found this session.
 *
 *   1. createBooking — already used a Serializable transaction + retry
 *      (Phase 10), but that protection had never been proven under a real
 *      concurrent-request test, only reasoned about. Proven here: two
 *      concurrent createBooking calls for the same court/overlapping time
 *      never both succeed.
 *   2. rescheduleBooking — did NOT have the same protection. A plain
 *      (READ COMMITTED, no retry) transaction let two concurrent
 *      reschedules onto overlapping times each read "available" from
 *      their own snapshot before either wrote — no unique constraint
 *      shaped like "no two active bookings on one court may overlap"
 *      exists to catch it at the write. Now routed through the same
 *      runSerializableWithRetry helper createBooking uses
 *      (lib/serializable-retry.ts).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService, type CreateBookingSaleContext } from "./booking.service";

const TEST_DATE = new Date(2031, 2, 3); // Monday, far enough out not to collide with real usage

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function slot(hour: number, minute = 0): Date {
  return new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hour, minute);
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

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// Fixture: no booking yet exists for this court/slot. Fires createBooking
// twice concurrently for the exact same court and time. The corruption is
// BOTH succeeding — two CONFIRMED bookings on one court for the same hour,
// something no customer-facing calendar should ever be able to show.
async function testCreateBookingNeverDoubleBooks(courtId: string, actorUserId: string, saleContext: CreateBookingSaleContext): Promise<void> {
  await cleanUp(courtId);
  const startAt = slot(10);
  const endAt = slot(11);

  console.log("  Firing 2 concurrent createBooking calls for the same court/time...");
  const results = await Promise.allSettled([
    bookingService.createBooking({ courtId, type: "HOURLY", startAt, endAt, guestName: "Race Guest A", paymentMethodId: saleContext.paymentMethodId }, actorUserId, saleContext),
    bookingService.createBooking({ courtId, type: "HOURLY", startAt, endAt, guestName: "Race Guest B", paymentMethodId: saleContext.paymentMethodId }, actorUserId, saleContext),
  ]);

  const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof bookingService.createBooking>>> => r.status === "fulfilled");
  console.log(`  Succeeded: ${fulfilled.length}/2`);

  const active = await prisma.booking.findMany({
    where: { courtId, status: { notIn: ["CANCELLED", "NO_SHOW"] }, startAt: { gte: slot(0), lt: slot(23, 59) } },
  });
  const overlapping = active.some((a, i) => active.some((b, j) => i !== j && overlaps(a.startAt, a.endAt, b.startAt, b.endAt)));
  assert(!overlapping, `two active bookings ended up overlapping on the same court — found ${active.length} active booking(s) in the window`);
  assert(active.length === 1, `expected exactly 1 booking to have won the race, found ${active.length}`);

  await cleanUp(courtId);
  console.log("PASS: concurrent createBooking calls for the same court/time never both succeed");
}

// Fixture: two existing, non-overlapping bookings (A at 10-11am, B at
// 1-2pm) on the same court. Fires two concurrent rescheduleBooking calls,
// each moving a DIFFERENT booking onto the SAME target slot (3-4pm). The
// corruption is BOTH succeeding — two active bookings overlapping at
// 3-4pm on one court.
async function testRescheduleBookingNeverDoubleBooks(courtId: string, actorUserId: string, saleContext: CreateBookingSaleContext): Promise<void> {
  await cleanUp(courtId);

  const bookingA = await bookingService.createBooking(
    { courtId, type: "HOURLY", startAt: slot(10), endAt: slot(11), guestName: "Reschedule Race A", paymentMethodId: saleContext.paymentMethodId },
    actorUserId,
    saleContext,
  );
  const bookingB = await bookingService.createBooking(
    { courtId, type: "HOURLY", startAt: slot(13), endAt: slot(14), guestName: "Reschedule Race B", paymentMethodId: saleContext.paymentMethodId },
    actorUserId,
    saleContext,
  );

  const targetStart = slot(15);
  const targetEnd = slot(16);

  console.log("  Firing 2 concurrent rescheduleBooking calls onto the same target slot...");
  await Promise.allSettled([
    bookingService.rescheduleBooking(bookingA.id, targetStart, targetEnd, actorUserId),
    bookingService.rescheduleBooking(bookingB.id, targetStart, targetEnd, actorUserId),
  ]);

  const active = await prisma.booking.findMany({
    where: { courtId, status: { notIn: ["CANCELLED", "NO_SHOW"] }, startAt: { gte: slot(0), lt: slot(23, 59) } },
  });
  const onTarget = active.filter((b) => overlaps(b.startAt, b.endAt, targetStart, targetEnd));
  console.log(`  Bookings ending up on the target slot: ${onTarget.length}`);
  assert(onTarget.length <= 1, `expected at most 1 booking to have won the reschedule race onto the target slot, found ${onTarget.length}`);

  const overlapping = active.some((a, i) => active.some((b, j) => i !== j && overlaps(a.startAt, a.endAt, b.startAt, b.endAt)));
  assert(!overlapping, "two active bookings ended up overlapping on the same court after a concurrent reschedule");

  await cleanUp(courtId);
  console.log("PASS: concurrent rescheduleBooking calls onto the same target slot never both succeed");
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-BOOKING-RACE-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });
  const saleContext: CreateBookingSaleContext = { employeeId: employee.id, shiftId: shift.id, paymentMethodId: paymentMethod.id };

  try {
    await testCreateBookingNeverDoubleBooks(court.id, owner.id, saleContext);
    await testRescheduleBookingNeverDoubleBooks(court.id, owner.id, saleContext);
  } finally {
    await cleanUp(court.id);
  }

  console.log("\nAll booking-service concurrency scenarios passed.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
