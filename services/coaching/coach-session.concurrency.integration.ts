/**
 * Gate 2, item 2 (BUILD-SPEC.md §15 process rule — a failing test before
 * the guard, then confirmed passing after; both runs reported, not just
 * the final state). The resource being protected is the COACH's time,
 * not the court's — two different court bookings at the same slot, both
 * attaching the same coach, is the exact collision this guards against.
 * createCoachSession already wraps the availability check, the
 * coach-double-booking check, and the insert in one Serializable
 * transaction (runSerializableWithRetry, §15's existing pattern — the
 * same one booking.service.ts's createBooking uses, not a new one).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService, type CreateBookingSaleContext } from "../booking/booking.service";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachRateService } from "./coach-rate.service";
import { coachSessionService } from "./coach-session.service";

const TEST_DATE = new Date(2031, 4, 8); // Thursday
const TEST_USERNAME_PREFIX = "it-coachrace-";

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

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

async function cleanUp(courtAId: string, courtBId: string): Promise<void> {
  const dayStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const bookings = await prisma.booking.findMany({
    where: { courtId: { in: [courtAId, courtBId] }, startAt: { gte: dayStart, lt: dayEnd } },
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
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, take: 2 });
  if (courts.length < 2) {
    throw new Error("This test needs at least 2 active courts — the collision is two DIFFERENT court bookings sharing one coach.");
  }
  const [courtA, courtB] = courts;
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-COACHRACE-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });
  const saleContext: CreateBookingSaleContext = { employeeId: employee.id, shiftId: shift.id, paymentMethodId: paymentMethod.id };

  await cleanUp(courtA.id, courtB.id);

  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });
  const coachUsername = `${TEST_USERNAME_PREFIX}${Date.now()}`;
  const coachUser = await prisma.user.create({ data: { name: "Race Coach", username: coachUsername, roleId: role.id } });
  const coach = await prisma.employee.create({
    data: { userId: coachUser.id, employeeNumber: `COACHRACE-${Date.now()}`, firstName: "Race", lastName: "Coach", isCoach: true },
  });
  await coachAvailabilityService.createWindow(
    { coachId: coach.id, startAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 8), endAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 20) },
    coach.id,
    owner.id,
  );
  await coachRateService.upsertRate({ coachId: coach.id, groupSize: 1, priceCents: 40000 }, owner.id);

  // Two DIFFERENT court bookings, same time slot — the court-level guard
  // doesn't apply (different courts), so both bookings themselves
  // succeed independently. The collision is both then trying to attach
  // the SAME coach to overlapping times.
  const testSlot = slot(11);
  const bookingA = await bookingService.createBooking(
    { courtId: courtA.id, type: "HOURLY", startAt: testSlot.startAt, endAt: testSlot.endAt, guestName: "Coach Race Guest A" },
    owner.id,
    saleContext,
  );
  const bookingB = await bookingService.createBooking(
    { courtId: courtB.id, type: "HOURLY", startAt: testSlot.startAt, endAt: testSlot.endAt, guestName: "Coach Race Guest B" },
    owner.id,
    saleContext,
  );

  console.log("  Firing 2 concurrent createCoachSession calls for the SAME coach, two different court bookings, same time slot...");
  const results = await Promise.allSettled([
    coachSessionService.createCoachSession({ bookingId: bookingA.id, coachId: coach.id, groupSize: 1 }, "STAFF", owner.id),
    coachSessionService.createCoachSession({ bookingId: bookingB.id, coachId: coach.id, groupSize: 1 }, "STAFF", owner.id),
  ]);
  const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof coachSessionService.createCoachSession>>> => r.status === "fulfilled");
  console.log(`  Succeeded: ${fulfilled.length}/2`);

  const activeSessions = await prisma.coachSession.findMany({
    where: { coachId: coach.id, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
    include: { booking: { select: { startAt: true, endAt: true } } },
  });
  const overlapping = activeSessions.some((a, i) =>
    activeSessions.some((b, j) => i !== j && overlaps(a.booking.startAt, a.booking.endAt, b.booking.startAt, b.booking.endAt)),
  );
  assert(!overlapping, `two active coach sessions ended up overlapping for the same coach — found ${activeSessions.length} active session(s) in the window`);
  assert(activeSessions.length === 1, `expected exactly 1 coach session to have won the race, found ${activeSessions.length}`);

  await cleanUp(courtA.id, courtB.id);
  console.log("PASS: concurrent createCoachSession calls for the same coach/overlapping time never both succeed.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
