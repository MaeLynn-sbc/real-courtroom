/**
 * Reported live: the coach picker (staff booking form's live preview, and
 * the public confirmation screen's add-coach step) offered a coach who was
 * already double-booked for the requested slot — their stated calendar
 * window covered it, but listAvailableCoaches never checked for an actual
 * overlapping CoachSession, only createCoachSession's own COACH_DOUBLE_BOOKED
 * guard did. Since both callers create the booking BEFORE attaching a coach
 * (a two-step submit, or the public flow's post-creation add-on), the
 * failure only ever surfaced after a booking already existed: staff saw a
 * "booking created, but the coach wasn't added" toast that read like a
 * system error rather than a slot that was never really available.
 *
 * Proven failing first against the pre-fix code (services/coaching/
 * coach-availability.service.ts's listAvailableCoaches had no
 * coachSessions exclusion at all) — this exact scenario returned the
 * double-booked coach before the fix; this file now proves it doesn't.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "../booking/booking.service";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachSessionService } from "./coach-session.service";

const TEST_USERNAME_PREFIX = "it-coachdoublebook-";
const TEST_DATE = new Date(2031, 4, 14);

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
  await prisma.coachSessionHistory.deleteMany({ where: { coachSession: { bookingId: { in: bookingIds } } } });
  await prisma.coachSession.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });

  const users = await prisma.user.findMany({ where: { username: { startsWith: TEST_USERNAME_PREFIX } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
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
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });
  const coachUser = await prisma.user.create({
    data: { name: `${TEST_USERNAME_PREFIX}coach-${suffix}`, username: `${TEST_USERNAME_PREFIX}coach-${suffix}`, roleId: role.id },
  });
  const coach = await prisma.employee.create({
    data: {
      userId: coachUser.id,
      employeeNumber: `${TEST_USERNAME_PREFIX}coach-${suffix}-num`,
      firstName: "Test",
      lastName: "Coach",
      isCoach: true,
    },
  });
  await prisma.coachRate.create({ data: { coachId: coach.id, groupSize: 1, priceCents: 50000 } });
  await coachAvailabilityService.createWindow(
    { coachId: coach.id, startAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 6), endAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 22) },
    coach.id,
    owner.id,
  );

  const occupiedSlot = slot(16);
  const bookingA = await bookingService.createBooking(
    { courtId: courtA.id, type: "HOURLY", startAt: occupiedSlot.startAt, endAt: occupiedSlot.endAt, guestName: "First Customer" },
    owner.id,
    { employeeId: coach.id, shiftId: undefined },
  );
  await coachSessionService.createCoachSession(
    { bookingId: bookingA.id, coachId: coach.id, groupSize: 1 },
    "STAFF",
    owner.id,
  );

  // The bug: the coach's calendar window covers 4-5pm, so a naive picker
  // still offers them for the exact slot they're already committed to.
  const pickerResult = await coachAvailabilityService.listAvailableCoaches(occupiedSlot.startAt, occupiedSlot.endAt);
  assert(
    !pickerResult.some((c) => c.id === coach.id),
    "expected the picker to exclude a coach already double-booked for this exact slot",
  );
  console.log("PASS: listAvailableCoaches excludes a coach with an active, overlapping CoachSession.");

  // Confirms the fix isn't just excluding the coach globally — a
  // genuinely free adjacent hour still offers them.
  const freeSlot = slot(18);
  const freeResult = await coachAvailabilityService.listAvailableCoaches(freeSlot.startAt, freeSlot.endAt);
  assert(
    freeResult.some((c) => c.id === coach.id),
    "expected the same coach to still be offered for a genuinely free, non-overlapping slot",
  );
  console.log("PASS: the same coach is still offered for a free slot elsewhere — not excluded globally.");

  // Confirms createCoachSession's own guard would have caught this too —
  // the picker fix closes the UX gap, this is still the real backstop.
  const bookingB = await bookingService.createBooking(
    { courtId: courtB.id, type: "HOURLY", startAt: occupiedSlot.startAt, endAt: occupiedSlot.endAt, guestName: "Second Customer" },
    owner.id,
    { employeeId: coach.id, shiftId: undefined },
  );
  let rejectedAsDoubleBooked = false;
  try {
    await coachSessionService.createCoachSession({ bookingId: bookingB.id, coachId: coach.id, groupSize: 1 }, "STAFF", owner.id);
  } catch (error) {
    rejectedAsDoubleBooked = error instanceof Error && error.message.includes("already booked for an overlapping time");
  }
  assert(rejectedAsDoubleBooked, "expected createCoachSession to still reject an actual double-booking attempt");
  console.log("PASS: createCoachSession's own COACH_DOUBLE_BOOKED guard is unchanged, still the real backstop.");

  await cleanUp([courtA.id, courtB.id]);
  console.log("\nPASS: coach picker no longer offers an already double-booked coach, proven against real rows.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
