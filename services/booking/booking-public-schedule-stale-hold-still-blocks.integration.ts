/**
 * Reversed 2026-08-03 (real incident — see checkAvailabilityWithClient's
 * own comment in booking.service.ts). getPublicDaySchedule previously
 * excluded an AWAITING_PAYMENT booking from bookedRanges once its
 * holdExpiresAt had passed, mirroring the (also-now-reversed) real
 * availability check. This proves the new behavior: a stale,
 * never-paid hold still shows as booked on the public grid — same as a
 * live one — since the court is still genuinely blocked for that
 * booking until a staff member cancels it.
 *
 * Formerly booking-public-schedule-expired-hold.integration.ts, which
 * asserted the opposite of what this now proves — renamed rather than
 * left with a name describing a bug this file used to guard against
 * and now guards the reversal of.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { getWebsiteBookingContext } from "./website-identity";

const TEST_DATE = new Date(2031, 1, 6); // Thursday, Feb 6 2031 — far enough out not to collide with real usage

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
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
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

async function main(): Promise<void> {
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const websiteContext = await getWebsiteBookingContext();
  await cleanUp(court.id);

  const staleStart = new Date(
    TEST_DATE.getFullYear(),
    TEST_DATE.getMonth(),
    TEST_DATE.getDate(),
    9,
    0,
  );
  const staleEnd = new Date(
    TEST_DATE.getFullYear(),
    TEST_DATE.getMonth(),
    TEST_DATE.getDate(),
    10,
    0,
  );
  const staleBooking = await prisma.booking.create({
    data: {
      bookingReference: `STALEHOLD-${Date.now()}`,
      courtId: court.id,
      bookedById: websiteContext.userId,
      type: "HOURLY",
      status: "AWAITING_PAYMENT",
      source: "PUBLIC",
      startAt: staleStart,
      endAt: staleEnd,
      guestName: "Stale Hold Guest",
      guestPhone: "09170000401",
      totalAmountCents: 35000,
      isAfterHours: false,
      holdExpiresAt: new Date(Date.now() - 60_000), // long since passed, like Rosela Tumaca's real booking
    },
  });

  const liveStart = new Date(
    TEST_DATE.getFullYear(),
    TEST_DATE.getMonth(),
    TEST_DATE.getDate(),
    14,
    0,
  );
  const liveEnd = new Date(
    TEST_DATE.getFullYear(),
    TEST_DATE.getMonth(),
    TEST_DATE.getDate(),
    15,
    0,
  );
  await prisma.booking.create({
    data: {
      bookingReference: `LIVEHOLD-${Date.now()}`,
      courtId: court.id,
      bookedById: websiteContext.userId,
      type: "HOURLY",
      status: "AWAITING_PAYMENT",
      source: "PUBLIC",
      startAt: liveStart,
      endAt: liveEnd,
      guestName: "Live Hold Guest",
      guestPhone: "09170000402",
      totalAmountCents: 35000,
      isAfterHours: false,
      holdExpiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000), // still valid
    },
  });

  // 1. The public grid must still show the stale hold as booked.
  const schedule = await bookingService.getPublicDaySchedule(TEST_DATE);
  const courtSchedule = schedule.find((entry) => entry.courtId === court.id);
  if (!courtSchedule) {
    throw new Error("expected a schedule entry for the test court");
  }

  const showsStale = courtSchedule.bookedRanges.some(
    (range) => range.startAt.getTime() === staleStart.getTime(),
  );
  const showsLive = courtSchedule.bookedRanges.some(
    (range) => range.startAt.getTime() === liveStart.getTime(),
  );

  console.log(`Stale hold (9-10am) shown as booked: ${showsStale}`);
  console.log(`Live hold (2-3pm) shown as booked: ${showsLive}`);

  assert(showsStale === true, "expected the STALE hold to still show as booked on the public grid");
  assert(showsLive === true, "expected the LIVE hold to still correctly show as booked");
  console.log("PASS: getPublicDaySchedule shows a stale hold as booked, same as a live one.");

  // 2. The real gate (checkAvailabilityWithClient, via the public
  // checkAvailability wrapper) must also refuse to let anyone else book
  // straight over the stale hold's exact slot.
  const conflict = await bookingService.checkAvailability(court.id, staleStart, staleEnd);
  console.log(`checkAvailability over the stale hold's own slot: available=${conflict.available}`);
  assert(
    conflict.available === false,
    "expected the stale hold to still block its own slot from a new booking",
  );
  assert(
    conflict.conflict?.type === "BOOKING",
    `expected a BOOKING conflict, got ${conflict.conflict?.type}`,
  );
  console.log(
    "PASS: checkAvailability still refuses to double-book over a stale, never-paid hold.",
  );

  // 3. Cancelling the stale hold — the only way it should ever release —
  // must free the slot immediately.
  await prisma.booking.update({ where: { id: staleBooking.id }, data: { status: "CANCELLED" } });
  const afterCancel = await bookingService.checkAvailability(court.id, staleStart, staleEnd);
  console.log(
    `checkAvailability after staff cancels the stale hold: available=${afterCancel.available}`,
  );
  assert(
    afterCancel.available === true,
    "expected the slot to free up once staff explicitly cancel the stale hold",
  );
  console.log("PASS: an explicit staff cancellation — and only that — frees a stale hold's slot.");

  await cleanUp(court.id);
  console.log(
    "PASS: a stale, never-paid hold keeps blocking its court on every surface until a staff member explicitly cancels it.",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
