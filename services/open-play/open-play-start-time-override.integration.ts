/**
 * Open play — per-date Fri/Sat start-time override. Owner request
 * (2026-08-08): "sometimes we want to have open play at earlier times" —
 * and it must be REAL enforcement, not display-only: a court that was
 * bookable a minute ago must become unavailable the moment the override is
 * saved, and go back to bookable once reset.
 *
 * Exercises the actual public booking path — bookingService.createBooking
 * with source: "WEBSITE" — the same call createPublicBookingAction makes
 * (see booking-source.integration.ts), NOT the standalone
 * checkAvailability() method: that one is a live pre-submit preview used
 * by the STAFF form and deliberately never enforces operating hours at all
 * (enforceOperatingHours defaults to false there — staff can book outside
 * normal hours by design). Only the WEBSITE-sourced createBooking path
 * (and the prepayment hold path) actually gates on it.
 *
 * Proves, against real rows:
 *   1. Before any override, a public WEBSITE booking on a slot between the
 *      new (earlier) time and the old default cutoff genuinely succeeds —
 *      the control case.
 *   2. overrideSessionStartTime moves the session's startAt AND flips
 *      startAtOverridden — and getStartTimeOverrideMinutes now resolves it.
 *   3. That SAME slot is now rejected by a WEBSITE-sourced createBooking
 *      call with a BookingConflictError, conflict.type
 *      OUTSIDE_OPERATING_HOURS.
 *   4. resetSessionStartTime clears the override — the slot is bookable
 *      again by the public path, and getStartTimeOverrideMinutes resolves
 *      to undefined.
 *
 * Uses a real near-future Friday (via getUpcomingNights, same convention
 * as open-play-closed-message.integration.ts) rather than a fixed
 * far-future fixture date.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService, BookingConflictError, type CreateBookingSaleContext } from "../booking/booking.service";
import { settingsService } from "../settings/settings.service";
import { openPlayCapacityService } from "./open-play-capacity.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function toTimeString(hours: number, minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}`;
}

async function cleanUpSession(date: Date): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date } });
  if (existing) {
    await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
  }
}

async function cleanUpBookings(courtId: string, dayStart: Date, dayEnd: Date): Promise<void> {
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
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-STARTOVERRIDE-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
    });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });
  const saleContext = {
    employeeId: employee.id,
    shiftId: shift.id,
    paymentMethodId: paymentMethod.id,
    source: "WEBSITE",
  } as CreateBookingSaleContext;

  const courtHours = await settingsService.getCourtHours();
  const defaultCloseMinutes = parseTimeToMinutes(courtHours.fridaySaturdayCloseTime);
  assert(
    defaultCloseMinutes >= 120,
    `expected the Fri/Sat close time to be at least 2 hours after midnight to leave room for an earlier override, got ${courtHours.fridaySaturdayCloseTime}`,
  );

  const overrideMinutes = defaultCloseMinutes - 120; // two hours earlier
  const overrideTime = toTimeString(Math.floor(overrideMinutes / 60), overrideMinutes % 60);
  // Midpoint between the override and the old default — bookable before
  // the override, blocked after it, bookable again once reset.
  const probeMinutes = overrideMinutes + 30;
  const probeHour = Math.floor(probeMinutes / 60);

  const upcoming = await openPlayCapacityService.getUpcomingNights(21);
  const friday = upcoming.find((n) => n.dayOfWeek === 5)?.date;
  assert(friday, "expected an upcoming Friday within 21 days");

  const slotStart = new Date(friday!);
  slotStart.setHours(probeHour, probeMinutes % 60, 0, 0);
  const slotEnd = new Date(slotStart.getTime() + 60 * 60_000);
  const dayStart = new Date(friday!.getFullYear(), friday!.getMonth(), friday!.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  await cleanUpSession(friday!);
  await cleanUpBookings(court.id, dayStart, dayEnd);

  try {
    // 1. Control: before any override, a public WEBSITE booking on this
    // slot genuinely succeeds.
    const before = await bookingService.createBooking(
      { courtId: court.id, type: "HOURLY", startAt: slotStart, endAt: slotEnd, guestName: "Before Override Guest" },
      owner.id,
      saleContext,
    );
    assert(before.id, "expected the control booking to succeed before any override");
    console.log("PASS: probe slot is bookable via the public path before any override (control case).");
    await cleanUpBookings(court.id, dayStart, dayEnd);

    // 2. Set the override.
    const overridden = await openPlayCapacityService.overrideSessionStartTime(
      friday!,
      overrideTime,
      owner.id,
    );
    assert(overridden.startAtOverridden, "expected startAtOverridden to be true after overriding");
    assert(
      overridden.startAt.getHours() * 60 + overridden.startAt.getMinutes() === overrideMinutes,
      `expected startAt to match the override time, got ${overridden.startAt.toISOString()}`,
    );
    const resolvedOverrideMinutes = await openPlayCapacityService.getStartTimeOverrideMinutes(
      friday!,
    );
    assert(
      resolvedOverrideMinutes === overrideMinutes,
      `expected getStartTimeOverrideMinutes to resolve the override, got ${resolvedOverrideMinutes}`,
    );
    console.log("PASS: overrideSessionStartTime updates startAt/startAtOverridden and resolves.");

    // 3. Real enforcement: the SAME slot is now rejected by the public
    // WEBSITE path.
    let rejected = false;
    try {
      await bookingService.createBooking(
        { courtId: court.id, type: "HOURLY", startAt: slotStart, endAt: slotEnd, guestName: "During Override Guest" },
        owner.id,
        saleContext,
      );
    } catch (error) {
      rejected = true;
      assert(error instanceof BookingConflictError, `expected a BookingConflictError, got ${error}`);
      assert(
        error.conflict.type === "OUTSIDE_OPERATING_HOURS",
        `expected an OUTSIDE_OPERATING_HOURS conflict, got ${JSON.stringify(error.conflict)}`,
      );
    }
    assert(rejected, "expected the public booking to be rejected once the earlier override is in effect");
    console.log(
      "PASS: the real public createBooking path rejects the same slot once overridden — not display-only.",
    );

    // 4. Reset clears the override — the slot is bookable again.
    const reset = await openPlayCapacityService.resetSessionStartTime(friday!, owner.id);
    assert(!reset.startAtOverridden, "expected startAtOverridden to be false after reset");
    const resolvedAfterReset = await openPlayCapacityService.getStartTimeOverrideMinutes(friday!);
    assert(
      resolvedAfterReset === undefined,
      `expected getStartTimeOverrideMinutes to resolve to undefined after reset, got ${resolvedAfterReset}`,
    );
    const after = await bookingService.createBooking(
      { courtId: court.id, type: "HOURLY", startAt: slotStart, endAt: slotEnd, guestName: "After Reset Guest" },
      owner.id,
      saleContext,
    );
    assert(after.id, "expected the probe slot to be bookable again after reset");
    console.log("PASS: resetSessionStartTime clears the override — the slot is bookable again.");

    await cleanUpBookings(court.id, dayStart, dayEnd);
    await cleanUpSession(friday!);
  } catch (error) {
    await cleanUpBookings(court.id, dayStart, dayEnd);
    await cleanUpSession(friday!);
    throw error;
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
