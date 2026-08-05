/**
 * Gate 3, item 1 — the load-bearing test. Not a test that omits
 * source/isOutsideAvailability from the request; a test that SENDS them
 * and proves the server ignores both, on the public path specifically.
 *
 * publicAddCoachSchema types `PublicAddCoachInput` as bookingId/coachId/
 * groupSize only — there is no TypeScript-legal way to pass source or
 * isOutsideAvailability to addPublicCoachToBooking. A real attacker
 * crafting a raw HTTP request isn't bound by that type, so this test
 * deliberately bypasses it too (`as unknown as PublicAddCoachInput`),
 * constructing exactly the kind of object a hand-crafted request body
 * would produce: bookingId/coachId/groupSize PLUS source: "STAFF" and
 * isOutsideAvailability: true riding along.
 *
 * Two scenarios, not one:
 *   1. A slot INSIDE the coach's availability window — the call
 *      succeeds either way, so this proves the forbidden fields don't
 *      leak into the created row even on a legitimate success.
 *   2. A slot OUTSIDE the coach's availability window — this proves the
 *      forbidden isOutsideAvailability:true has ZERO functional effect
 *      on the public path: if it worked even partially, this would
 *      succeed instead of being rejected.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService, type CreateBookingSaleContext } from "../booking/booking.service";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachRateService } from "./coach-rate.service";
import { addPublicCoachToBooking } from "./public-coach-session";
import type { PublicAddCoachInput } from "@/features/coaching/schemas/public-coaching.schema";

const TEST_DATE = new Date(2031, 4, 10); // Saturday
const TEST_USERNAME_PREFIX = "it-forbidden-";

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
  const websiteUser = await prisma.user.findFirstOrThrow({ where: { email: "website@thecourtroom.local" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-FORBIDDEN-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });
  const saleContext: CreateBookingSaleContext = { employeeId: employee.id, shiftId: shift.id, paymentMethodId: paymentMethod.id };

  await cleanUp(court.id);

  const role = await prisma.role.findFirstOrThrow({ where: { name: "COURT_ATTENDANT" } });
  const coachUsername = `${TEST_USERNAME_PREFIX}${Date.now()}`;
  const coachUser = await prisma.user.create({ data: { name: "Forbidden Coach", username: coachUsername, roleId: role.id } });
  const coach = await prisma.employee.create({
    data: { userId: coachUser.id, employeeNumber: `FORBIDDEN-${Date.now()}`, firstName: "Forbidden", lastName: "Coach", isCoach: true },
  });
  // Window covers 08:00-12:00 only — the "inside" scenario uses 09:00,
  // the "outside" scenario uses 14:00, which this window does NOT cover.
  await coachAvailabilityService.createWindow(
    { coachId: coach.id, startAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 8), endAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 12) },
    coach.id,
    owner.id,
  );
  await coachRateService.upsertRate({ coachId: coach.id, groupSize: 1, priceCents: 45000 }, owner.id);

  // --- Scenario 1: slot INSIDE the window ---
  const insideSlot = slot(9);
  const insideBooking = await bookingService.createBooking(
    { courtId: court.id, type: "HOURLY", startAt: insideSlot.startAt, endAt: insideSlot.endAt, guestName: "Forbidden Inside Guest" },
    owner.id,
    saleContext,
  );

  // Deliberately sending forbidden values — this is what a hand-crafted
  // request body would look like. Cast bypasses the type system exactly
  // the way an attacker's raw JSON would bypass it at runtime.
  const forbiddenInsideInput = {
    bookingId: insideBooking.id,
    coachId: coach.id,
    groupSize: 1,
    source: "STAFF",
    isOutsideAvailability: true,
  } as unknown as PublicAddCoachInput;

  const insideResult = await addPublicCoachToBooking(forbiddenInsideInput, websiteUser.id);
  assert(insideResult.error === null, `expected the inside-window call to succeed, got error: ${insideResult.error}`);
  assert(insideResult.coachSessionId, "expected a coachSessionId on success");
  console.log("SENT: { source: 'STAFF', isOutsideAvailability: true } on a slot INSIDE the coach's window.");
  console.log(`RESULT: call succeeded (coachSessionId=${insideResult.coachSessionId}).`);

  const insideSession = await prisma.coachSession.findUniqueOrThrow({ where: { id: insideResult.coachSessionId } });
  assert(insideSession.source === "PUBLIC", `expected source to be forced PUBLIC regardless of the sent value, got ${insideSession.source}`);
  assert(insideSession.isOutsideAvailability === false, `expected isOutsideAvailability to be forced false regardless of the sent value, got ${insideSession.isOutsideAvailability}`);
  console.log(`VERIFIED: stored row has source=${insideSession.source} (sent 'STAFF'), isOutsideAvailability=${insideSession.isOutsideAvailability} (sent true) — both ignored.`);

  // --- Scenario 2: slot OUTSIDE the window, same forbidden override ---
  const outsideSlot = slot(14);
  const outsideBooking = await bookingService.createBooking(
    { courtId: court.id, type: "HOURLY", startAt: outsideSlot.startAt, endAt: outsideSlot.endAt, guestName: "Forbidden Outside Guest" },
    owner.id,
    saleContext,
  );

  const forbiddenOutsideInput = {
    bookingId: outsideBooking.id,
    coachId: coach.id,
    groupSize: 1,
    source: "STAFF",
    isOutsideAvailability: true,
  } as unknown as PublicAddCoachInput;

  const outsideResult = await addPublicCoachToBooking(forbiddenOutsideInput, websiteUser.id);
  console.log("SENT: { source: 'STAFF', isOutsideAvailability: true } on a slot OUTSIDE the coach's window.");
  console.log(`RESULT: error='${outsideResult.error}'.`);
  assert(outsideResult.error !== null, "expected the outside-window call to be REJECTED even with isOutsideAvailability:true sent — the override has zero effect on the public path");
  assert(!outsideResult.coachSessionId, "expected no coachSessionId when rejected");
  const outsideSessionCheck = await prisma.coachSession.findUnique({ where: { bookingId: outsideBooking.id } });
  assert(outsideSessionCheck === null, "expected no CoachSession row to have been created for the rejected outside-window attempt");
  console.log("VERIFIED: no session created — the sent isOutsideAvailability:true had zero effect on the public path.");

  await cleanUp(court.id);
  console.log("PASS: public path hardcodes source=PUBLIC and ignores isOutsideAvailability, proven by SENDING both forbidden values, not omitting them.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
