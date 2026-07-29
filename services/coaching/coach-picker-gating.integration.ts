/**
 * Gate 2, item 4: "only an employee with isCoach can hold availability
 * windows and appear in the coach picker. An employee without it is
 * invisible to coaching regardless of permissions." The availability-
 * window half is proven in coach-availability-ownership.integration.ts;
 * this proves the picker queries and the session-creation path itself
 * both exclude a non-coach employee — not just the window-creation call.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService, type CreateBookingSaleContext } from "../booking/booking.service";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachSessionService, CoachSessionConflictError } from "./coach-session.service";

const TEST_USERNAME_PREFIX = "it-pickergate-";
const TEST_DATE = new Date(2031, 4, 7);

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

async function createEmployee(username: string, isCoach: boolean) {
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });
  const user = await prisma.user.create({ data: { name: username, username, roleId: role.id } });
  return prisma.employee.create({
    data: { userId: user.id, employeeNumber: `${username}-num`, firstName: "Test", lastName: "Employee", isCoach },
  });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-PICKERGATE-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });
  const saleContext: CreateBookingSaleContext = { employeeId: employee.id, shiftId: shift.id, paymentMethodId: paymentMethod.id };

  await cleanUp(court.id);

  const suffix = Date.now();
  const coach = await createEmployee(`${TEST_USERNAME_PREFIX}coach-${suffix}`, true);
  const notCoach = await createEmployee(`${TEST_USERNAME_PREFIX}notcoach-${suffix}`, false);

  const windowStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 8);
  const windowEnd = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 18);
  await coachAvailabilityService.createWindow({ coachId: coach.id, startAt: windowStart, endAt: windowEnd }, coach.id, owner.id);

  const testSlot = slot(10);

  const availableCoaches = await coachAvailabilityService.listAvailableCoaches(testSlot.startAt, testSlot.endAt);
  assert(availableCoaches.some((c) => c.id === coach.id), "expected the real coach to appear in the picker for a covered slot");
  assert(!availableCoaches.some((c) => c.id === notCoach.id), "expected the non-coach employee to be absent from the picker");
  console.log("PASS: the coach picker (listAvailableCoaches) includes the real coach and excludes the non-coach employee.");

  const allCoaches = await coachAvailabilityService.listCoaches();
  assert(allCoaches.some((c) => c.id === coach.id), "expected the real coach in listCoaches");
  assert(!allCoaches.some((c) => c.id === notCoach.id), "expected the non-coach employee to be absent from listCoaches");
  console.log("PASS: listCoaches (the availability-management picker) excludes the non-coach employee too.");

  const booking = await bookingService.createBooking(
    { courtId: court.id, type: "HOURLY", startAt: testSlot.startAt, endAt: testSlot.endAt, guestName: "Picker Gate Guest" },
    owner.id,
    saleContext,
  );

  let rejectedAsNotCoach = false;
  try {
    await coachSessionService.createCoachSession({ bookingId: booking.id, coachId: notCoach.id, groupSize: 1 }, "STAFF", owner.id);
  } catch (error) {
    rejectedAsNotCoach = error instanceof CoachSessionConflictError && error.type === "NOT_A_COACH";
  }
  assert(rejectedAsNotCoach, "expected createCoachSession to refuse a coachId pointing at a non-coach employee");
  console.log("PASS: createCoachSession refuses a coachId that isn't marked isCoach, independent of the picker.");

  await cleanUp(court.id);
  console.log("PASS: isCoach gating proven for both the picker and session creation.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
