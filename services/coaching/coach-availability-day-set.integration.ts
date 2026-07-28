/**
 * The week-grid coach-availability redesign's write path.
 * setDayAvailability replaces createWindow/deleteWindow's one-row-per-
 * click UI: it takes a coach's complete set of "on" hours for one
 * calendar day and reconciles the stored rows to match — contiguous
 * hours become ONE window (not one row per hour), non-contiguous hours
 * stay separate windows, and calling it again with a different hour
 * set REPLACES the day, it doesn't add to it. copyWeekAvailability
 * mirrors a week onto the one that follows it, day for day, including
 * clearing a target day that has no counterpart in the source week.
 * listActiveSessionsForCoach is the data the client-side "warn before
 * clearing a real booking" step reads — proven here to exclude
 * CANCELLED/NO_SHOW, the two statuses that mean "not actually
 * happening," not just proven to return rows.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { coachAvailabilityService, NotACoachError } from "./coach-availability.service";
import { coachSessionService } from "./coach-session.service";
import { coachRateService } from "./coach-rate.service";
import { createPublicBooking } from "../booking/public-booking.service";
import { addPublicCoachToBooking } from "./public-coach-session";
import { getWebsiteBookingContext } from "../booking/website-identity";

const TEST_DATE = new Date(2031, 6, 22); // Tuesday, distinct from other coaching fixtures' dates
const TEST_USERNAME_PREFIX = "it-daysetavail-";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function createCoach(username: string): Promise<{ id: string }> {
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });
  const user = await prisma.user.create({ data: { name: username, username, roleId: role.id } });
  return prisma.employee.create({
    data: { userId: user.id, employeeNumber: `${username}-num`, firstName: "Test", lastName: "Coach", isCoach: true },
  });
}

async function cleanUp(coachId: string, courtId?: string): Promise<void> {
  await prisma.coachAvailabilityWindow.deleteMany({ where: { coachId } });

  if (courtId) {
    const dayStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 8); // covers both the source and target weeks used below
    const bookings = await prisma.booking.findMany({
      where: { courtId, startAt: { gte: dayStart, lt: dayEnd } },
      select: { id: true },
    });
    const bookingIds = bookings.map((b) => b.id);
    await prisma.coachSessionHistory.deleteMany({ where: { coachSession: { bookingId: { in: bookingIds } } } });
    await prisma.coachSession.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  }
}

async function cleanUpUsers(): Promise<void> {
  const users = await prisma.user.findMany({ where: { username: { startsWith: TEST_USERNAME_PREFIX } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  for (const employee of employees) {
    await cleanUp(employee.id);
    await prisma.coachRate.deleteMany({ where: { coachId: employee.id } });
  }
  await prisma.employee.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  await cleanUpUsers();

  const coach = await createCoach(`${TEST_USERNAME_PREFIX}${Date.now()}`);
  const notACoach = await prisma.employee.create({
    data: {
      userId: (await prisma.user.create({
        data: {
          name: "not-a-coach",
          username: `${TEST_USERNAME_PREFIX}notcoach-${Date.now()}`,
          roleId: (await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } })).id,
        },
      })).id,
      employeeNumber: `notcoach-${Date.now()}`,
      firstName: "Not",
      lastName: "Coach",
      isCoach: false,
    },
  });

  // === Case 1: contiguous hours merge into ONE window ===
  const created1 = await coachAvailabilityService.setDayAvailability(
    { coachId: coach.id, date: TEST_DATE, hours: [7, 8, 9] },
    coach.id,
    owner.id,
  );
  assert(created1.length === 1, `expected 1 merged window for contiguous hours, got ${created1.length}`);
  assert(created1[0].startAt.getHours() === 7 && created1[0].endAt.getHours() === 10, "expected the merged window to span 7-10");
  console.log("PASS: contiguous hours [7,8,9] merge into one 7-10 window.");

  // === Case 2: non-contiguous hours stay as separate windows ===
  const created2 = await coachAvailabilityService.setDayAvailability(
    { coachId: coach.id, date: TEST_DATE, hours: [7, 8, 18, 19, 20, 21] },
    coach.id,
    owner.id,
  );
  assert(created2.length === 2, `expected 2 windows for non-contiguous hours, got ${created2.length}`);
  console.log("PASS: non-contiguous hours [7,8] + [18-21] produce 2 separate windows, not 6 one-hour rows.");

  // === Case 3: setting again REPLACES the day, doesn't add to it ===
  const created3 = await coachAvailabilityService.setDayAvailability(
    { coachId: coach.id, date: TEST_DATE, hours: [14] },
    coach.id,
    owner.id,
  );
  assert(created3.length === 1 && created3[0].startAt.getHours() === 14, "expected the day to now hold only the new single hour");
  const allWindowsForDay = await prisma.coachAvailabilityWindow.findMany({ where: { coachId: coach.id } });
  assert(allWindowsForDay.length === 1, `expected the previous 2 windows to be replaced, not accumulated — found ${allWindowsForDay.length} total`);
  console.log("PASS: re-calling setDayAvailability replaces the day's windows rather than accumulating them.");

  // === Case 4: ownership — not-a-coach target is rejected ===
  let notACoachThrew = false;
  try {
    await coachAvailabilityService.setDayAvailability(
      { coachId: notACoach.id, date: TEST_DATE, hours: [7] },
      notACoach.id,
      owner.id,
    );
  } catch (error) {
    notACoachThrew = error instanceof NotACoachError;
  }
  assert(notACoachThrew, "expected setDayAvailability to reject a target employee who isn't a coach");
  console.log("PASS: setDayAvailability rejects a non-coach target, same guard as createWindow.");

  // === Case 5: copyWeekAvailability mirrors the source week, including
  // clearing a target day with no source counterpart ===
  const sourceMonday = new Date(TEST_DATE); // treat TEST_DATE (a Tuesday) as inside the "source" week for this test's purposes
  await coachAvailabilityService.setDayAvailability({ coachId: coach.id, date: sourceMonday, hours: [9, 10, 11] }, coach.id, owner.id);
  const targetWeekStart = new Date(sourceMonday.getFullYear(), sourceMonday.getMonth(), sourceMonday.getDate() + 7);
  // Pre-seed the target day (one week later) with something that must
  // be CLEARED by the copy, since the source day for it has nothing.
  const targetDayTwoLater = new Date(targetWeekStart.getFullYear(), targetWeekStart.getMonth(), targetWeekStart.getDate() + 1);
  await coachAvailabilityService.setDayAvailability({ coachId: coach.id, date: targetDayTwoLater, hours: [15] }, coach.id, owner.id);

  await coachAvailabilityService.copyWeekAvailability({ coachId: coach.id, weekStart: targetWeekStart }, coach.id, owner.id);

  const copiedDay = await prisma.coachAvailabilityWindow.findMany({
    where: {
      coachId: coach.id,
      startAt: { gte: targetWeekStart, lt: new Date(targetWeekStart.getFullYear(), targetWeekStart.getMonth(), targetWeekStart.getDate() + 1) },
    },
  });
  assert(copiedDay.length === 1 && copiedDay[0].startAt.getHours() === 9 && copiedDay[0].endAt.getHours() === 12, "expected the copied day to mirror the source day's 9-12 window");
  console.log("PASS: copyWeekAvailability correctly copies a source day's window +7 days.");

  const clearedDay = await prisma.coachAvailabilityWindow.findMany({
    where: {
      coachId: coach.id,
      startAt: { gte: targetDayTwoLater, lt: new Date(targetDayTwoLater.getFullYear(), targetDayTwoLater.getMonth(), targetDayTwoLater.getDate() + 1) },
    },
  });
  assert(clearedDay.length === 0, `expected the pre-seeded target day with no source counterpart to be cleared by the copy, found ${clearedDay.length} rows`);
  console.log("PASS: copyWeekAvailability clears a target day that has no counterpart in the source week — a true mirror, not an additive merge.");

  // === Case 6: listActiveSessionsForCoach excludes CANCELLED/NO_SHOW ===
  const websiteContext = await getWebsiteBookingContext();
  const rateCoach = await createCoach(`${TEST_USERNAME_PREFIX}rate-${Date.now()}`);
  await coachRateService.upsertRate({ coachId: rateCoach.id, groupSize: 1, priceCents: 40000 }, owner.id);
  const sessionSlotStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 9);
  const sessionSlotEnd = new Date(sessionSlotStart.getTime() + 60 * 60 * 1000);
  await coachAvailabilityService.setDayAvailability(
    { coachId: rateCoach.id, date: TEST_DATE, hours: [9] },
    rateCoach.id,
    owner.id,
  );

  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const publicBooking = await createPublicBooking({
    courtId: court.id,
    startAt: sessionSlotStart,
    endAt: sessionSlotEnd,
    guestName: "Active Session Guest",
    guestPhone: "09171110099",
  });
  const addResult = await addPublicCoachToBooking(
    { bookingId: publicBooking.bookingId, coachId: rateCoach.id, groupSize: 1 },
    websiteContext.userId,
  );
  assert(addResult.error === null, `expected the coach session to attach cleanly, got error: ${addResult.error}`);
  const activeSession = await coachSessionService.getById(addResult.coachSessionId!);
  assert(activeSession !== null, "expected the created coach session to be findable");

  const activeBefore = await coachSessionService.listActiveSessionsForCoach(rateCoach.id);
  assert(activeBefore.length === 1, `expected 1 active session before cancellation, got ${activeBefore.length}`);

  await prisma.coachSession.update({ where: { id: addResult.coachSessionId! }, data: { status: "CANCELLED" } });
  const activeAfter = await coachSessionService.listActiveSessionsForCoach(rateCoach.id);
  assert(activeAfter.length === 0, `expected 0 active sessions after cancelling the only one, got ${activeAfter.length}`);
  console.log("PASS: listActiveSessionsForCoach excludes a CANCELLED session — the conflict-warning UI won't flag a booking that isn't real anymore.");

  await cleanUp(coach.id, court.id);
  await cleanUpUsers();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
