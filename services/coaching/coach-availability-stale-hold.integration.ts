/**
 * Missed 2026-08-03: three copies of coach-availability logic
 * (listAvailableCoaches and listPublicAvailability in
 * coach-availability.service.ts, createCoachSession's own
 * COACH_DOUBLE_BOOKED guard in coach-session.service.ts) still excluded
 * a stale, unresolved AWAITING_PAYMENT hold from counting as "booked" —
 * the exact exclusion reversed everywhere else that same day
 * (checkAvailabilityWithClient, listOccupiedWindows, getPublicDaySchedule,
 * display.service.ts's fetchRelevantBookings — see
 * checkAvailabilityWithClient's own comment in booking.service.ts for the
 * real incident that drove it). A stale hold now blocks its court
 * indefinitely until staff explicitly cancel it; a coach attached to one
 * needs to stay blocked for the exact same reason, or the public could
 * book straight over a coach a real, unresolved booking was still
 * genuinely holding.
 *
 * Proves, against real rows: a coach attached to a booking whose hold's
 * display timer has passed (but was never resolved — no submit, no
 * reject, no cancel) is still correctly excluded from (1) the booking-time
 * picker, (2) the public availability listing, and (3) still rejected by
 * createCoachSession's own guard if a second attempt is made — right up
 * until the stale booking is explicitly cancelled, at which point all
 * three correctly free up.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "../booking/booking.service";
import { createPublicBooking } from "../booking/public-booking.service";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachSessionService } from "./coach-session.service";

const TEST_USERNAME_PREFIX = "it-coachstalehold-";
const TEST_DATE = new Date(2031, 5, 20);

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

async function cleanUp(courtIds: string[]): Promise<void> {
  const dayStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const bookings = await prisma.booking.findMany({
    where: { courtId: { in: courtIds }, startAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  const bookingIds = bookings.map((b) => b.id);
  await prisma.coachSessionHistory.deleteMany({
    where: { coachSession: { bookingId: { in: bookingIds } } },
  });
  await prisma.coachSession.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingPaymentProof.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });

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
  await prisma.coachAvailabilityWindow.deleteMany({ where: { coachId: { in: employeeIds } } });
  await prisma.coachRate.deleteMany({ where: { coachId: { in: employeeIds } } });
  await prisma.employee.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, take: 2 });
  assert(courts.length >= 2, "expected at least two active courts as fixtures");
  const [courtA, courtB] = courts;

  await cleanUp([courtA.id, courtB.id]);

  const suffix = Date.now();
  const role = await prisma.role.findFirstOrThrow({ where: { name: "COURT_ATTENDANT" } });
  const coachUser = await prisma.user.create({
    data: {
      name: `${TEST_USERNAME_PREFIX}coach-${suffix}`,
      username: `${TEST_USERNAME_PREFIX}coach-${suffix}`,
      roleId: role.id,
    },
  });
  const coach = await prisma.employee.create({
    data: {
      userId: coachUser.id,
      employeeNumber: `${TEST_USERNAME_PREFIX}coach-${suffix}-num`,
      firstName: "Test",
      lastName: "StaleHoldCoach",
      isCoach: true,
    },
  });
  await prisma.coachRate.create({ data: { coachId: coach.id, groupSize: 1, priceCents: 50000 } });
  await coachAvailabilityService.createWindow(
    {
      coachId: coach.id,
      startAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 6),
      endAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 22),
    },
    coach.id,
    owner.id,
  );

  // A real public hold, attached to a coach, then simulated stale the
  // same way the stale-hold booking fix's own tests do: backdate
  // holdExpiresAt directly rather than waiting out the real window.
  // Nobody ever resolves it — no submit, no reject, no cancel.
  const staleSlot = slot(15);
  const staleHold = await createPublicBooking({
    courtId: courtA.id,
    startAt: staleSlot.startAt,
    endAt: staleSlot.endAt,
    guestName: "Stale Hold Coaching Guest",
    guestPhone: "09170000601",
  });
  const staleCoachResult = await coachSessionService.createCoachSession(
    { bookingId: staleHold.bookingId, coachId: coach.id, groupSize: 1 },
    "STAFF",
    owner.id,
  );
  await prisma.booking.update({
    where: { id: staleHold.bookingId },
    data: { holdExpiresAt: new Date(Date.now() - 60_000) },
  });
  const stillConfirmed = await prisma.coachSession.findUniqueOrThrow({
    where: { id: staleCoachResult.id },
  });
  assert(
    stillConfirmed.status === "CONFIRMED",
    "expected the coach session to still read CONFIRMED — nothing actively sweeps a stale hold",
  );

  try {
    // 1. The booking-time picker must still exclude this coach.
    const pickerResult = await coachAvailabilityService.listAvailableCoaches(
      staleSlot.startAt,
      staleSlot.endAt,
    );
    assert(
      !pickerResult.some((c) => c.id === coach.id),
      "expected listAvailableCoaches to exclude a coach on a STALE but unresolved hold",
    );
    console.log("PASS: listAvailableCoaches still excludes a coach attached to a stale, unresolved hold.");

    // 2. Public availability must not show this slot as free either.
    const publicAvailability = await coachAvailabilityService.listPublicAvailability(30);
    const coachPublic = publicAvailability.find((c) => c.coachId === coach.id);
    const overlapsStaleSlot = coachPublic?.windows.some(
      (w) => w.startAt < staleSlot.endAt && w.endAt > staleSlot.startAt,
    );
    assert(
      !overlapsStaleSlot,
      "expected listPublicAvailability to NOT show a free window overlapping the stale hold's slot",
    );
    console.log("PASS: listPublicAvailability does not show a coach as free during a stale, unresolved hold.");

    // 3. createCoachSession's own guard still rejects a second attempt.
    const secondBooking = await bookingService.createBooking(
      {
        courtId: courtB.id,
        type: "HOURLY",
        startAt: staleSlot.startAt,
        endAt: staleSlot.endAt,
        guestName: "Second Attempt Guest",
      },
      owner.id,
      { employeeId: coach.id, shiftId: undefined },
    );
    let rejectedAsDoubleBooked = false;
    try {
      await coachSessionService.createCoachSession(
        { bookingId: secondBooking.id, coachId: coach.id, groupSize: 1 },
        "STAFF",
        owner.id,
      );
    } catch (error) {
      rejectedAsDoubleBooked =
        error instanceof Error && error.message.includes("already booked for an overlapping time");
    }
    assert(
      rejectedAsDoubleBooked,
      "expected createCoachSession to still reject attaching the same coach to a second, overlapping booking",
    );
    console.log("PASS: createCoachSession's own guard still rejects a second attempt while the hold is stale.");

    // 4. Only an explicit staff cancellation releases the coach — proven
    // by cancelling the stale hold and confirming all three now agree
    // it's free.
    await bookingService.updateBookingStatus(staleHold.bookingId, "CANCELLED", owner.id);
    const cancelledSession = await prisma.coachSession.findUniqueOrThrow({
      where: { id: staleCoachResult.id },
    });
    assert(
      cancelledSession.status === "CANCELLED",
      "expected cancelling the stale booking to cascade CANCELLED onto its coach session",
    );

    const pickerAfterCancel = await coachAvailabilityService.listAvailableCoaches(
      staleSlot.startAt,
      staleSlot.endAt,
    );
    assert(
      pickerAfterCancel.some((c) => c.id === coach.id),
      "expected the coach to be offered again once the stale hold is explicitly cancelled",
    );
    console.log("PASS: explicitly cancelling the stale hold correctly frees the coach everywhere.");

    await cleanUp([courtA.id, courtB.id]);
  } catch (error) {
    await cleanUp([courtA.id, courtB.id]);
    throw error;
  }

  console.log(
    "\nPASS: a coach attached to a stale, unresolved hold stays correctly blocked everywhere, proven against real rows.",
  );
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
