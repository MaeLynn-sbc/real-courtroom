/**
 * Gate 3, item 5: "cancelling the court booking already removes the
 * coach session" only actually happens if updateBookingStatus
 * propagates it — nothing in this app hard-deletes a Booking row
 * (cancellation is a status update, never a DELETE), so
 * CoachSession.bookingId's ON DELETE CASCADE from Gate 1 never fires
 * from real usage. This proves the propagation booking.service.ts's
 * updateBookingStatus now does explicitly, since the DB-level cascade
 * alone doesn't cover it.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService, type CreateBookingSaleContext } from "../booking/booking.service";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachRateService } from "./coach-rate.service";
import { coachSessionService } from "./coach-session.service";

const TEST_DATE = new Date(2031, 4, 9); // Friday
const TEST_USERNAME_PREFIX = "it-cancelcascade-";

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

async function cleanUp(courtId: string): Promise<void> {
  const dayStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const bookings = await prisma.booking.findMany({ where: { courtId, startAt: { gte: dayStart, lt: dayEnd } }, select: { id: true } });
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
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-CANCELCASCADE-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });
  const saleContext: CreateBookingSaleContext = { employeeId: employee.id, shiftId: shift.id, paymentMethodId: paymentMethod.id };

  await cleanUp(court.id);

  const role = await prisma.role.findFirstOrThrow({ where: { name: "COURT_ATTENDANT" } });
  const coachUsername = `${TEST_USERNAME_PREFIX}${Date.now()}`;
  const coachUser = await prisma.user.create({ data: { name: "Cascade Coach", username: coachUsername, roleId: role.id } });
  const coach = await prisma.employee.create({
    data: { userId: coachUser.id, employeeNumber: `CANCELCASCADE-${Date.now()}`, firstName: "Cascade", lastName: "Coach", isCoach: true },
  });
  await coachAvailabilityService.createWindow(
    { coachId: coach.id, startAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 8), endAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 18) },
    coach.id,
    owner.id,
  );
  await coachRateService.upsertRate({ coachId: coach.id, groupSize: 1, priceCents: 40000 }, owner.id);

  const testSlot = slot(10);
  const booking = await bookingService.createBooking(
    { courtId: court.id, type: "HOURLY", startAt: testSlot.startAt, endAt: testSlot.endAt, guestName: "Cascade Guest" },
    owner.id,
    saleContext,
  );
  const coachSession = await coachSessionService.createCoachSession(
    { bookingId: booking.id, coachId: coach.id, groupSize: 1 },
    "STAFF",
    owner.id,
  );
  assert(coachSession.status === "CONFIRMED", "expected the coach session to start CONFIRMED");
  console.log("PASS: booking + coach session created, both active.");

  await bookingService.updateBookingStatus(booking.id, "CANCELLED", owner.id, "Test cancellation");

  const refetchedSession = await prisma.coachSession.findUniqueOrThrow({ where: { id: coachSession.id } });
  assert(refetchedSession.status === "CANCELLED", `expected the coach session to cascade to CANCELLED, got ${refetchedSession.status}`);
  assert(refetchedSession.cancelledAt !== null, "expected the coach session's cancelledAt to be stamped");
  console.log("PASS: cancelling the court booking cascaded CANCELLED onto its coach session.");

  const history = await prisma.coachSessionHistory.findMany({ where: { coachSessionId: coachSession.id }, orderBy: { createdAt: "desc" } });
  assert(history[0]?.status === "CANCELLED", "expected a CoachSessionHistory row recording the cascade");
  console.log("PASS: the cascade is recorded in CoachSessionHistory, same as any other status change.");

  // A booking with NO coach session must cancel cleanly too — the
  // cascade check must not throw when there's nothing to cascade to.
  const bareSlot = slot(13);
  const bareBooking = await bookingService.createBooking(
    { courtId: court.id, type: "HOURLY", startAt: bareSlot.startAt, endAt: bareSlot.endAt, guestName: "No Coach Guest" },
    owner.id,
    saleContext,
  );
  await bookingService.updateBookingStatus(bareBooking.id, "CANCELLED", owner.id);
  console.log("PASS: cancelling a booking with no coach session doesn't error.");

  await cleanUp(court.id);
  console.log("PASS: booking-cancellation-to-coach-session cascade proven against real rows.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
