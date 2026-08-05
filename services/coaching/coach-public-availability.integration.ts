/**
 * Public coach-availability view (read-only, no login) — "when ARE
 * coaches free," not "is coach X free for this exact slot"
 * (listAvailableCoaches, already covered by coach-availability-excludes-
 * double-booked.integration.ts). Proves the actual new logic:
 * listPublicAvailability subtracts a real, overlapping booked
 * CoachSession from a coach's stated window, and that a booking outside
 * the window doesn't affect it.
 *
 * Unlike most integration tests in this codebase, this one can't use a
 * fixed far-future fixture date — listPublicAvailability windows its
 * query off the real wall-clock `now` (the same way the public page
 * itself will call it), so the fixtures here are built relative to
 * Date.now() instead.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "../booking/booking.service";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachSessionService } from "./coach-session.service";

const TEST_USERNAME_PREFIX = "it-coachpublicavail-";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

// Tomorrow, at a fixed hour — close enough to "real now" to land inside
// listPublicAvailability's own [now, now+days] window, far enough ahead
// that it can't collide with "right now" itself (which the window-
// clipping logic would otherwise need to reason about).
function tomorrowAt(hour: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hour, 0, 0, 0);
}

async function cleanUp(courtIds: string[]): Promise<void> {
  const users = await prisma.user.findMany({ where: { username: { startsWith: TEST_USERNAME_PREFIX } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const employeeIds = employees.map((e) => e.id);

  const bookings = await prisma.booking.findMany({
    where: { courtId: { in: courtIds }, startAt: { gte: tomorrowAt(0), lt: tomorrowAt(24) } },
    select: { id: true },
  });
  const bookingIds = bookings.map((b) => b.id);
  await prisma.coachSessionHistory.deleteMany({ where: { coachSession: { bookingId: { in: bookingIds } } } });
  await prisma.coachSession.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });

  await prisma.coachAvailabilityWindow.deleteMany({ where: { coachId: { in: employeeIds } } });
  await prisma.coachRate.deleteMany({ where: { coachId: { in: employeeIds } } });
  await prisma.employee.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, take: 1 });
  assert(courts.length >= 1, "expected at least one active court as a fixture");
  const [court] = courts;

  await cleanUp([court.id]);

  const suffix = Date.now();
  const role = await prisma.role.findFirstOrThrow({ where: { name: "COURT_ATTENDANT" } });
  const coachUser = await prisma.user.create({
    data: { name: `${TEST_USERNAME_PREFIX}coach-${suffix}`, username: `${TEST_USERNAME_PREFIX}coach-${suffix}`, roleId: role.id },
  });
  const coach = await prisma.employee.create({
    data: {
      userId: coachUser.id,
      employeeNumber: `${TEST_USERNAME_PREFIX}coach-${suffix}-num`,
      firstName: "Public",
      lastName: "Coach",
      isCoach: true,
    },
  });
  await prisma.coachRate.create({ data: { coachId: coach.id, groupSize: 1, priceCents: 50000 } });

  // Stated window: tomorrow 6am-10pm.
  await coachAvailabilityService.createWindow(
    { coachId: coach.id, startAt: tomorrowAt(6), endAt: tomorrowAt(22) },
    coach.id,
    owner.id,
  );

  // A real booked session, 4-5pm tomorrow — must be carved out of the
  // free windows returned.
  const bookedBooking = await bookingService.createBooking(
    { courtId: court.id, type: "HOURLY", startAt: tomorrowAt(16), endAt: tomorrowAt(17), guestName: "Public Availability Customer" },
    owner.id,
    { employeeId: coach.id, shiftId: undefined },
  );
  await coachSessionService.createCoachSession(
    { bookingId: bookedBooking.id, coachId: coach.id, groupSize: 1 },
    "STAFF",
    owner.id,
  );

  const availability = await coachAvailabilityService.listPublicAvailability(14);
  const entry = availability.find((a) => a.coachId === coach.id);
  assert(entry, "expected the test coach to appear in listPublicAvailability's output");

  const overlapsBookedHour = entry!.windows.some(
    (window) => window.startAt < tomorrowAt(17) && window.endAt > tomorrowAt(16),
  );
  assert(!overlapsBookedHour, "expected no free window to overlap the booked 4-5pm session");

  const coversBeforeBooked = entry!.windows.some(
    (window) => window.startAt <= tomorrowAt(6) && window.endAt >= tomorrowAt(16),
  );
  assert(coversBeforeBooked, "expected a free window covering 6am up to the booked session at 4pm");

  const coversAfterBooked = entry!.windows.some(
    (window) => window.startAt <= tomorrowAt(17) && window.endAt >= tomorrowAt(22),
  );
  assert(coversAfterBooked, "expected a free window covering 5pm (right after the booked session) through 10pm");

  console.log("PASS: listPublicAvailability carves the booked 4-5pm session out of the coach's 6am-10pm window.");
  console.log(
    `      free windows: ${entry!.windows.map((w) => `${w.startAt.toLocaleTimeString()}–${w.endAt.toLocaleTimeString()}`).join(", ")}`,
  );

  // A DIFFERENT coach, with no bookings at all, should show their full
  // stated window untouched — proves the subtraction isn't accidentally
  // over-eager (e.g. subtracting some other coach's session).
  const soloCoachUser = await prisma.user.create({
    data: {
      name: `${TEST_USERNAME_PREFIX}solo-${suffix}`,
      username: `${TEST_USERNAME_PREFIX}solo-${suffix}`,
      roleId: role.id,
    },
  });
  const soloCoach = await prisma.employee.create({
    data: {
      userId: soloCoachUser.id,
      employeeNumber: `${TEST_USERNAME_PREFIX}solo-${suffix}-num`,
      firstName: "Unbooked",
      lastName: "Coach",
      isCoach: true,
    },
  });
  await coachAvailabilityService.createWindow(
    { coachId: soloCoach.id, startAt: tomorrowAt(8), endAt: tomorrowAt(9) },
    soloCoach.id,
    owner.id,
  );

  const availabilityAfter = await coachAvailabilityService.listPublicAvailability(14);
  const soloEntry = availabilityAfter.find((a) => a.coachId === soloCoach.id);
  assert(soloEntry, "expected the unbooked coach to appear too");
  assert(soloEntry!.windows.length === 1, `expected exactly one untouched free window, got ${soloEntry!.windows.length}`);
  assert(
    soloEntry!.windows[0].startAt.getTime() === tomorrowAt(8).getTime() &&
      soloEntry!.windows[0].endAt.getTime() === tomorrowAt(9).getTime(),
    "expected the unbooked coach's window to pass through completely unchanged",
  );
  console.log("PASS: a coach with no booked sessions shows their full stated window, untouched.");

  await cleanUp([court.id]);
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
