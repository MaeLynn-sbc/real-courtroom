/**
 * Owner request (2026-08-02): the public availability grid flags a
 * booking that has a coach with its own cell state ("bookedCoach"),
 * distinct from a plain "booked" court — sourced from
 * getPublicDaySchedule's own bookedRanges (hasCoach), computed in ONE
 * query (a JOIN on Booking.coachSession), not a per-cell follow-up.
 * Proves, against real rows:
 *   1. A booking with an active (non-cancelled) CoachSession reports
 *      hasCoach: true in bookedRanges.
 *   2. A plain booking with no CoachSession at all reports hasCoach:
 *      false.
 *   3. A booking whose CoachSession was later CANCELLED (the "remove
 *      coach" path — services/coaching/coach-session.service.ts's
 *      cancelCoachSession sets status, never deletes the row) reports
 *      hasCoach: false, not still coached. Proven failing-first: this
 *      assertion would fail against a version of the fix that checked
 *      coachSession != null without also checking status.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";

const TEST_DATE = new Date(2031, 5, 11); // Wednesday, distinct from other fixture dates in this session

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function slot(hour: number): { startAt: Date; endAt: Date } {
  const startAt = new Date(
    TEST_DATE.getFullYear(),
    TEST_DATE.getMonth(),
    TEST_DATE.getDate(),
    hour,
    0,
  );
  const endAt = new Date(startAt);
  endAt.setHours(endAt.getHours() + 1);
  return { startAt, endAt };
}

const TEST_USERNAME_PREFIX = "booking-coach-cell-test-";

async function cleanUp(courtId: string): Promise<void> {
  const dayStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const bookings = await prisma.booking.findMany({
    where: { courtId, startAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  const ids = bookings.map((b) => b.id);
  await prisma.coachSessionHistory.deleteMany({ where: { coachSessionId: { in: ids } } });
  await prisma.coachSession.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });

  const users = await prisma.user.findMany({
    where: { username: { startsWith: TEST_USERNAME_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const employeeIds = employees.map((e) => e.id);
  await prisma.coachSession.deleteMany({ where: { coachId: { in: employeeIds } } });
  await prisma.shift.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });

  await cleanUp(court.id);

  const coachUsername = `${TEST_USERNAME_PREFIX}${Date.now()}`;
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });
  const coachUser = await prisma.user.create({
    data: { name: coachUsername, username: coachUsername, roleId: role.id },
  });
  const coach = await prisma.employee.create({
    data: {
      userId: coachUser.id,
      employeeNumber: `${coachUsername}-num`,
      firstName: "Test",
      lastName: "Coach",
      isCoach: true,
    },
  });
  const shift = await prisma.shift.create({
    data: { shiftNumber: `SHIFT-COACHCELL-${Date.now()}`, employeeId: coach.id, status: "OPEN" },
  });

  try {
    // ============== 1. A booking WITH an active coach session ==============
    const coachedSlot = slot(9);
    const coachedBooking = await bookingService.createBooking(
      {
        courtId: court.id,
        type: "HOURLY",
        startAt: coachedSlot.startAt,
        endAt: coachedSlot.endAt,
        guestName: "Coached Booking Guest",
      },
      owner.id,
      { employeeId: coach.id, shiftId: shift.id },
    );
    await prisma.coachSession.create({
      data: {
        sessionReference: `CS-TEST-${Date.now()}`,
        bookingId: coachedBooking.id,
        coachId: coach.id,
        bookedById: owner.id,
        groupSize: 1,
        rateCents: 50000,
        status: "CONFIRMED",
        source: "STAFF",
      },
    });

    const scheduleAfterCoach = await bookingService.getPublicDaySchedule(TEST_DATE);
    const courtScheduleAfterCoach = scheduleAfterCoach.find((s) => s.courtId === court.id)!;
    const coachedRange = courtScheduleAfterCoach.bookedRanges.find(
      (r) => r.startAt.getTime() === coachedSlot.startAt.getTime(),
    );
    assert(coachedRange, "expected the coached booking to appear in bookedRanges");
    assert(
      coachedRange!.hasCoach === true,
      `expected hasCoach true for a booking with an active CoachSession, got ${coachedRange!.hasCoach}`,
    );
    console.log(
      "PASS: a booking with an active CoachSession reports hasCoach: true, in the same one-query getPublicDaySchedule already made.",
    );

    // ============== 2. A plain booking with NO coach session ==============
    const plainSlot = slot(11);
    await bookingService.createBooking(
      {
        courtId: court.id,
        type: "HOURLY",
        startAt: plainSlot.startAt,
        endAt: plainSlot.endAt,
        guestName: "Plain Booking Guest",
      },
      owner.id,
      { employeeId: coach.id, shiftId: shift.id },
    );
    const scheduleWithPlain = await bookingService.getPublicDaySchedule(TEST_DATE);
    const plainRange = scheduleWithPlain
      .find((s) => s.courtId === court.id)!
      .bookedRanges.find((r) => r.startAt.getTime() === plainSlot.startAt.getTime());
    assert(plainRange, "expected the plain booking to appear in bookedRanges");
    assert(
      plainRange!.hasCoach === false,
      `expected hasCoach false for a booking with no CoachSession at all, got ${plainRange!.hasCoach}`,
    );
    console.log("PASS: a plain booking with no CoachSession reports hasCoach: false.");

    // ============== 3. A CANCELLED coach session must not still read as coached ==============
    const coachSession = await prisma.coachSession.findUniqueOrThrow({
      where: { bookingId: coachedBooking.id },
    });
    await prisma.coachSession.update({
      where: { id: coachSession.id },
      data: { status: "CANCELLED" },
    });

    const scheduleAfterCancel = await bookingService.getPublicDaySchedule(TEST_DATE);
    const cancelledRange = scheduleAfterCancel
      .find((s) => s.courtId === court.id)!
      .bookedRanges.find((r) => r.startAt.getTime() === coachedSlot.startAt.getTime());
    assert(
      cancelledRange,
      "expected the booking to still appear in bookedRanges after its coach was cancelled",
    );
    assert(
      cancelledRange!.hasCoach === false,
      `expected hasCoach false once the CoachSession is CANCELLED (row still exists, status changed) — got ${cancelledRange!.hasCoach}`,
    );
    console.log(
      "PASS: a booking whose coach was later cancelled (row retained, status CANCELLED, per removeCoachSession's own design) no longer reports hasCoach: true.",
    );

    await cleanUp(court.id);
    console.log("\nPASS: coach-cell hasCoach flag proven against real rows.");
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
