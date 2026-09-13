/**
 * The coached window (2026-09-13): coaching sits on a chosen hour inside
 * the court time, and EVERYTHING about the coach's time — the picker,
 * the availability check, the double-booking check, the SMS, the
 * calendar feed — uses that window, never the booking's full span.
 *
 * The complaint that drove it: a 2-hour court booking with 1 paid
 * coaching hour told the coach "5:00 PM-7:00 PM", so the coach worked
 * two hours for one hour's pay.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService, type CreateBookingSaleContext } from "../booking/booking.service";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachSessionService, CoachSessionConflictError } from "./coach-session.service";

const TEST_USERNAME_PREFIX = "it-coachwindow-";
const TEST_DATE = new Date(2031, 4, 9);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const at = (hour: number) => new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hour, 0);

async function conflictType(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof CoachSessionConflictError) return error.type;
    throw error;
  }
}

async function cleanUp(courtIds: string[]): Promise<void> {
  const dayStart = at(0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const bookings = await prisma.booking.findMany({
    where: { courtId: { in: courtIds }, startAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  const bookingIds = bookings.map((b) => b.id);
  await prisma.coachSessionHistory.deleteMany({ where: { coachSession: { bookingId: { in: bookingIds } } } });
  await prisma.coachSession.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.sale.deleteMany({ where: { bookingId: { in: bookingIds } } });
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
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, take: 2, orderBy: { name: "asc" } });
  assert(courts.length === 2, "needs two courts");
  const [courtA, courtB] = courts;
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-COACHWINDOW-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });
  const saleContext: CreateBookingSaleContext = { employeeId: employee.id, shiftId: shift.id, paymentMethodId: paymentMethod.id };

  await cleanUp([courtA.id, courtB.id]);

  const role = await prisma.role.findFirstOrThrow({ where: { name: "COURT_ATTENDANT" } });
  const username = `${TEST_USERNAME_PREFIX}${Date.now()}`;
  const user = await prisma.user.create({ data: { name: "Window Coach", username, roleId: role.id } });
  const coach = await prisma.employee.create({
    data: { userId: user.id, employeeNumber: `${username}-num`, firstName: "Window", lastName: "Coach", isCoach: true, phone: "09171234567" },
  });
  await prisma.coachRate.create({ data: { coachId: coach.id, groupSize: 1, priceCents: 40000 } });

  // The coach is free for ONE hour, 6-7 PM. The customer books the court 5-7 PM.
  await coachAvailabilityService.createWindow({ coachId: coach.id, startAt: at(18), endAt: at(19) }, coach.id, owner.id);

  // 1. The picker offers the coach for the 2-hour slot, and says which hour.
  const forTwoHours = await coachAvailabilityService.listAvailableCoaches(at(17), at(19));
  const offered = forTwoHours.find((c) => c.id === coach.id);
  assert(offered, "a coach free for one whole hour of a 2-hour slot is offered (old rule: hidden)");
  assert(
    offered.freeWindows.length === 1 && offered.freeWindows[0].startAt.getTime() === at(18).getTime() && offered.freeWindows[0].endAt.getTime() === at(19).getTime(),
    "freeWindows names exactly the 6-7 PM hour",
  );
  const forFirstHourOnly = await coachAvailabilityService.listAvailableCoaches(at(17), at(18));
  assert(!forFirstHourOnly.some((c) => c.id === coach.id), "not offered for a slot where no whole hour is free");
  console.log("PASS: the picker offers the coach for the hour they can give, with the free window spelled out.");

  const bookingA = await bookingService.createBooking(
    { courtId: courtA.id, type: "HOURLY", startAt: at(17), endAt: at(19), guestName: "Window Guest A" },
    owner.id,
    saleContext,
  );

  // 2. The server checks availability for the COACHED window, not the booking.
  assert(
    (await conflictType(() => coachSessionService.createCoachSession({ bookingId: bookingA.id, coachId: coach.id, groupSize: 1, hours: 1, startOffsetHours: 0 }, "PUBLIC", owner.id))) === "OUTSIDE_AVAILABILITY",
    "the first hour (5-6 PM) is outside the coach's window",
  );
  assert(
    (await conflictType(() => coachSessionService.createCoachSession({ bookingId: bookingA.id, coachId: coach.id, groupSize: 1, hours: 2, startOffsetHours: 1 }, "PUBLIC", owner.id))) === "WINDOW_OUTSIDE_BOOKING",
    "2 hours from 6 PM runs past a 7 PM court end",
  );
  assert(
    (await conflictType(() => coachSessionService.createCoachSession({ bookingId: bookingA.id, coachId: coach.id, groupSize: 1, hours: 3, startOffsetHours: 0 }, "PUBLIC", owner.id))) === "HOURS_EXCEED_BOOKING",
    "3 hours on a 2-hour court is still refused",
  );
  const sessionA = await coachSessionService.createCoachSession(
    { bookingId: bookingA.id, coachId: coach.id, groupSize: 1, hours: 1, startOffsetHours: 1 },
    "PUBLIC",
    owner.id,
  );
  assert(sessionA.hours === 1 && sessionA.startOffsetHours === 1 && sessionA.rateCents === 40000, "the session stores 1 hour starting 1 hour in");
  console.log("PASS: creation validates the coached window against the coach's availability and the court time.");

  // 3. The coach's text names the coached hour, not the booking's span.
  const sms = await prisma.smsLog.findFirst({ where: { trigger: "COACH_SESSION", entityId: sessionA.id }, orderBy: { createdAt: "desc" } });
  assert(sms, "a coach SMS was logged");
  assert(sms.body.includes("6:00 PM-7:00 PM"), `SMS states the coached hour, got: ${sms.body}`);
  assert(!sms.body.includes("5:00 PM"), `SMS must not state the booking's 5 PM start, got: ${sms.body}`);
  console.log("PASS: the coach is told the hour they are booked and paid for.");

  // 4. The calendar feed carries the span, so the 5-6 PM hour reads as free.
  const active = await coachSessionService.listActiveSessionsForCoach(coach.id);
  const feed = active.find((s) => s.id === sessionA.id);
  assert(feed && feed.hours === 1 && feed.startOffsetHours === 1, "listActiveSessionsForCoach exposes hours and startOffsetHours");

  // 5. Double-booking is judged on the coached window: the coach can still
  //    take 5-6 PM on another court, but not 6-7 PM.
  await coachAvailabilityService.createWindow({ coachId: coach.id, startAt: at(17), endAt: at(18) }, coach.id, owner.id);
  const bookingB = await bookingService.createBooking(
    { courtId: courtB.id, type: "HOURLY", startAt: at(17), endAt: at(18), guestName: "Window Guest B" },
    owner.id,
    saleContext,
  );
  const forB = await coachAvailabilityService.listAvailableCoaches(at(17), at(18));
  assert(forB.some((c) => c.id === coach.id), "the picker offers the coach for 5-6 PM even though their 6-7 PM is taken (old rule: hidden by booking A's span)");
  const sessionB = await coachSessionService.createCoachSession(
    { bookingId: bookingB.id, coachId: coach.id, groupSize: 1, hours: 1, startOffsetHours: 0 },
    "STAFF",
    owner.id,
  );
  assert(sessionB.startOffsetHours === 0, "5-6 PM on court B is accepted");
  await coachSessionService.cancelCoachSession(sessionB.id, owner.id);
  const bookingC = await bookingService.createBooking(
    { courtId: courtB.id, type: "HOURLY", startAt: at(18), endAt: at(19), guestName: "Window Guest C" },
    owner.id,
    saleContext,
  );
  assert(
    (await conflictType(() => coachSessionService.createCoachSession({ bookingId: bookingC.id, coachId: coach.id, groupSize: 1 }, "STAFF", owner.id))) === "COACH_DOUBLE_BOOKED",
    "6-7 PM on court B collides with session A's coached hour",
  );
  const forC = await coachAvailabilityService.listAvailableCoaches(at(18), at(19));
  assert(!forC.some((c) => c.id === coach.id), "the picker hides the coach for the hour they are already coaching");
  console.log("PASS: the coach's time is blocked for the coached hour only, across courts.");

  // 6. The public availability page also subtracts the coached hour only.
  const publicView = await coachAvailabilityService.listPublicAvailability(2000);
  const mine = publicView.find((entry) => entry.coachId === coach.id);
  assert(mine, "the coach appears on the public availability view");
  const fiveToSix = mine.windows.some((w) => w.startAt.getTime() === at(17).getTime() && w.endAt.getTime() === at(18).getTime());
  const sixToSeven = mine.windows.some((w) => w.startAt < at(19) && w.endAt > at(18));
  assert(fiveToSix && !sixToSeven, "5-6 PM is shown free (session B cancelled), 6-7 PM is not");
  console.log("PASS: the public availability view subtracts the coached hour, not the booking.");

  // 7. A booking can move, but not shrink out from under its coaching.
  let refused = "";
  try {
    await bookingService.changeBookingSlot(bookingA.id, { newEndAt: at(18) }, owner.id, at(9));
  } catch (error) {
    refused = (error as Error).message;
  }
  assert(/coaching no longer fits/i.test(refused), `shrinking 5-7 PM to 5-6 PM must be refused for the 6-7 PM coaching, got: ${refused}`);
  console.log("PASS: a booking cannot be shortened past its coached window.");

  await cleanUp([courtA.id, courtB.id]);
  console.log("PASS: coached window proven end to end.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
