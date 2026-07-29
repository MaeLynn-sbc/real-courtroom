/**
 * Gate 2, item 1: CoachSession.rateCents must snapshot CoachRate at
 * creation — editing the rate table afterward must never rewrite an
 * existing session. Same lesson, same shape as
 * player-tab.integration.ts's rental-line-item snapshot test.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService, type CreateBookingSaleContext } from "../booking/booking.service";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachRateService } from "./coach-rate.service";
import { coachSessionService } from "./coach-session.service";

const TEST_DATE = new Date(2031, 4, 5); // Monday, far enough out not to collide with real usage
const TEST_USERNAME_PREFIX = "it-ratesnap-";

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

// Self-contained (finds stale coaches by username prefix rather than
// taking a coachId) so it's safe to call both BEFORE creating this run's
// fixtures (cleaning up a previous failed run) and again AFTER (normal
// teardown) without ever deleting the coach this run just created out
// from under itself.
async function cleanUp(courtId: string): Promise<void> {
  const dayStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const bookings = await prisma.booking.findMany({
    where: { courtId, startAt: { gte: dayStart, lt: dayEnd } },
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
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-RATESNAP-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });
  const saleContext: CreateBookingSaleContext = { employeeId: employee.id, shiftId: shift.id, paymentMethodId: paymentMethod.id };

  await cleanUp(court.id);

  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });
  const coachUsername = `${TEST_USERNAME_PREFIX}${Date.now()}`;
  const coachUser = await prisma.user.create({
    data: { name: "Rate Snapshot Coach", username: coachUsername, roleId: role.id },
  });
  const coach = await prisma.employee.create({
    data: { userId: coachUser.id, employeeNumber: `RATESNAP-${Date.now()}`, firstName: "Rate", lastName: "Coach", isCoach: true },
  });

  await coachAvailabilityService.createWindow(
    { coachId: coach.id, startAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 8), endAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 18) },
    coach.id,
    owner.id,
  );

  await coachRateService.upsertRate({ coachId: coach.id, groupSize: 2, priceCents: 50000 }, owner.id);

  const firstSlot = slot(10);
  const firstBooking = await bookingService.createBooking(
    { courtId: court.id, type: "HOURLY", startAt: firstSlot.startAt, endAt: firstSlot.endAt, guestName: "Rate Snapshot Guest A" },
    owner.id,
    saleContext,
  );
  const firstSession = await coachSessionService.createCoachSession(
    { bookingId: firstBooking.id, coachId: coach.id, groupSize: 2 },
    "STAFF",
    owner.id,
  );
  assert(firstSession.rateCents === 50000, `expected the first session to snapshot 50000, got ${firstSession.rateCents}`);
  console.log(`PASS: first coach session snapshotted rateCents = ${firstSession.rateCents}`);

  // Reprice — must not rewrite the already-created session.
  await coachRateService.upsertRate({ coachId: coach.id, groupSize: 2, priceCents: 60000 }, owner.id);

  const refetchedFirst = await prisma.coachSession.findUniqueOrThrow({ where: { id: firstSession.id } });
  assert(refetchedFirst.rateCents === 50000, `expected the existing session's rateCents to stay 50000 after repricing, got ${refetchedFirst.rateCents}`);
  console.log("PASS: repricing CoachRate did not rewrite the existing session's snapshotted rateCents.");

  // A NEW session created after the reprice picks up the new rate.
  const secondSlot = slot(13);
  const secondBooking = await bookingService.createBooking(
    { courtId: court.id, type: "HOURLY", startAt: secondSlot.startAt, endAt: secondSlot.endAt, guestName: "Rate Snapshot Guest B" },
    owner.id,
    saleContext,
  );
  const secondSession = await coachSessionService.createCoachSession(
    { bookingId: secondBooking.id, coachId: coach.id, groupSize: 2 },
    "STAFF",
    owner.id,
  );
  assert(secondSession.rateCents === 60000, `expected the second session to snapshot the NEW rate 60000, got ${secondSession.rateCents}`);
  console.log("PASS: a session created after repricing snapshots the new rate.");

  await cleanUp(court.id);
  console.log("PASS: CoachSession.rateCents snapshot behavior proven against real rows.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
