/**
 * Owner request (2026-08-05): "a grid view in the staff side ... put a
 * name of the person who booked and the coach as well." Staff-only twin
 * of getPublicDaySchedule (services/booking/booking-public-schedule-
 * coach.integration.ts) — proves getStaffDaySchedule surfaces exactly
 * what the public one deliberately withholds.
 *
 * Proves, against real rows:
 *   1. A guest booking (no Player) reports customerName === guestName.
 *   2. A booking with an active coach session reports the coach's real
 *      name and hasCoach: true, plus a real bookingId/bookingReference
 *      the staff grid links through to.
 *   3. A booking whose coach was later CANCELLED reports hasCoach:
 *      false, same exclusion rule getPublicDaySchedule already proves —
 *      not duplicated logic, the same underlying query shape.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";

const TEST_DATE = new Date(2031, 5, 12); // Thursday, distinct from other fixture dates in this session

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function slot(hour: number): { startAt: Date; endAt: Date } {
  const startAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hour, 0);
  const endAt = new Date(startAt);
  endAt.setHours(endAt.getHours() + 1);
  return { startAt, endAt };
}

const TEST_USERNAME_PREFIX = "booking-staff-schedule-test-";

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
      lastName: "StaffScheduleCoach",
      isCoach: true,
    },
  });
  const shift = await prisma.shift.create({
    data: { shiftNumber: `SHIFT-STAFFSCHED-${Date.now()}`, employeeId: coach.id, status: "OPEN" },
  });

  try {
    // ============== 1. Guest booking -> customerName === guestName ==============
    const guestSlot = slot(9);
    const guestBooking = await bookingService.createBooking(
      { courtId: court.id, type: "HOURLY", startAt: guestSlot.startAt, endAt: guestSlot.endAt, guestName: "Staff Grid Guest" },
      owner.id,
      { employeeId: coach.id, shiftId: shift.id },
    );

    const scheduleAfterGuest = await bookingService.getStaffDaySchedule(TEST_DATE);
    const guestRange = scheduleAfterGuest
      .find((s) => s.courtId === court.id)!
      .bookedRanges.find((r) => r.startAt.getTime() === guestSlot.startAt.getTime());
    assert(guestRange, "expected the guest booking to appear in bookedRanges");
    assert(
      guestRange!.customerName === "Staff Grid Guest",
      `expected customerName "Staff Grid Guest", got ${guestRange!.customerName}`,
    );
    assert(guestRange!.bookingId === guestBooking.id, "expected the real bookingId to ride along");
    assert(
      guestRange!.bookingReference === guestBooking.bookingReference,
      "expected the real bookingReference to ride along",
    );
    console.log("PASS: a guest booking reports customerName, bookingId, and bookingReference correctly.");

    // ============== 2. Coached booking -> real coach name, hasCoach true ==============
    const coachedSlot = slot(11);
    const coachedBooking = await bookingService.createBooking(
      { courtId: court.id, type: "HOURLY", startAt: coachedSlot.startAt, endAt: coachedSlot.endAt, guestName: "Coached Staff Grid Guest" },
      owner.id,
      { employeeId: coach.id, shiftId: shift.id },
    );
    await prisma.coachSession.create({
      data: {
        sessionReference: `CS-STAFFSCHED-${Date.now()}`,
        bookingId: coachedBooking.id,
        coachId: coach.id,
        bookedById: owner.id,
        groupSize: 1,
        rateCents: 50000,
        status: "CONFIRMED",
        source: "STAFF",
      },
    });

    const scheduleWithCoach = await bookingService.getStaffDaySchedule(TEST_DATE);
    const coachedRange = scheduleWithCoach
      .find((s) => s.courtId === court.id)!
      .bookedRanges.find((r) => r.startAt.getTime() === coachedSlot.startAt.getTime());
    assert(coachedRange, "expected the coached booking to appear in bookedRanges");
    assert(coachedRange!.hasCoach === true, `expected hasCoach true, got ${coachedRange!.hasCoach}`);
    assert(
      coachedRange!.coachName === "Test StaffScheduleCoach",
      `expected coachName "Test StaffScheduleCoach", got ${coachedRange!.coachName}`,
    );
    console.log("PASS: a coached booking reports the real coach name and hasCoach: true.");

    // ============== 3. CANCELLED coach session -> hasCoach false ==============
    const coachSession = await prisma.coachSession.findUniqueOrThrow({ where: { bookingId: coachedBooking.id } });
    await prisma.coachSession.update({ where: { id: coachSession.id }, data: { status: "CANCELLED" } });

    const scheduleAfterCancel = await bookingService.getStaffDaySchedule(TEST_DATE);
    const cancelledRange = scheduleAfterCancel
      .find((s) => s.courtId === court.id)!
      .bookedRanges.find((r) => r.startAt.getTime() === coachedSlot.startAt.getTime());
    assert(cancelledRange, "expected the booking to still appear in bookedRanges after its coach was cancelled");
    assert(
      cancelledRange!.hasCoach === false,
      `expected hasCoach false once the CoachSession is CANCELLED, got ${cancelledRange!.hasCoach}`,
    );
    console.log("PASS: a booking whose coach was later cancelled no longer reports hasCoach: true.");

    await cleanUp(court.id);
    console.log("\nPASS: getStaffDaySchedule (customer + coach names, the staff grid's data source) proven against real rows.");
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
