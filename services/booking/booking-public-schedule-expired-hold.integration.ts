/**
 * getPublicDaySchedule (the query behind the homepage grid and
 * /availability) previously only excluded CANCELLED/NO_SHOW bookings —
 * unlike checkAvailabilityWithClient (the real booking-creation check),
 * it had no holdExpiresAt exclusion, so a slot could keep showing
 * "Booked" for up to the full hold window after the hold had actually
 * expired. This proves the fix: an expired AWAITING_PAYMENT hold no
 * longer appears in bookedRanges, while a live (unexpired) hold still
 * correctly does.
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

  const expiredStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 9, 0);
  const expiredEnd = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 10, 0);
  await prisma.booking.create({
    data: {
      bookingReference: `EXPHOLD-${Date.now()}`,
      courtId: court.id,
      bookedById: websiteContext.userId,
      type: "HOURLY",
      status: "AWAITING_PAYMENT",
      source: "PUBLIC",
      startAt: expiredStart,
      endAt: expiredEnd,
      guestName: "Expired Hold Guest",
      guestPhone: "09170000401",
      totalAmountCents: 35000,
      isAfterHours: false,
      holdExpiresAt: new Date(Date.now() - 60_000), // already passed
    },
  });

  const liveStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 14, 0);
  const liveEnd = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 15, 0);
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

  const schedule = await bookingService.getPublicDaySchedule(TEST_DATE);
  const courtSchedule = schedule.find((entry) => entry.courtId === court.id);
  if (!courtSchedule) {
    throw new Error("expected a schedule entry for the test court");
  }

  const showsExpired = courtSchedule.bookedRanges.some(
    (range) => range.startAt.getTime() === expiredStart.getTime(),
  );
  const showsLive = courtSchedule.bookedRanges.some((range) => range.startAt.getTime() === liveStart.getTime());

  console.log(`Expired hold (9-10am) shown as booked: ${showsExpired}`);
  console.log(`Live hold (2-3pm) shown as booked: ${showsLive}`);

  assert(showsExpired === false, "expected the EXPIRED hold to be excluded from bookedRanges — the bug this fixes");
  assert(showsLive === true, "expected the LIVE (unexpired) hold to still correctly show as booked");

  await cleanUp(court.id);
  console.log("PASS: getPublicDaySchedule now excludes an expired AWAITING_PAYMENT hold, same as the real availability check, while still showing a live hold as booked.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
