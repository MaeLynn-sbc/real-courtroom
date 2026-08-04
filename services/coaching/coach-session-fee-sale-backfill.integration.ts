/**
 * Proves scripts/backfill-coaching-fee-sales.ts against real rows, not
 * just its logic in isolation. Confirmed live against production: 6
 * real bookings already had exactly this shape (a non-cancelled coach
 * session, a real court-only BOOKING Sale, no COACHING Sale) before the
 * live-path fix landed — this seeds two historical-shaped fixtures (raw
 * inserts, bypassing every service, the way those real pre-fix rows
 * looked) and runs the real backfillCoachingFeeSales() against them.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { backfillCoachingFeeSales } from "../../scripts/backfill-coaching-fee-sales";
import { coachAvailabilityService } from "./coach-availability.service";

const TEST_DATE = new Date(2031, 6, 29); // Monday, distinct from other integration fixtures' dates
const TEST_USERNAME_PREFIX = "it-coachfeesalebackfill-";
const COACH_RATE_CENTS = 40000; // ₱400

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

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
  await prisma.sale.deleteMany({
    where: { OR: [{ bookingId: { in: bookingIds } }, { coachSession: { bookingId: { in: bookingIds } } }] },
  });
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
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: ownerEmployee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-COACHFEESALEBACKFILL-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }

  await cleanUp(court.id);

  const coachUsername = `${TEST_USERNAME_PREFIX}${Date.now()}`;
  const coachUser = await prisma.user.create({
    data: { name: `${TEST_USERNAME_PREFIX}Coach`, username: coachUsername, roleId: role.id },
  });
  const coach = await prisma.employee.create({
    data: {
      userId: coachUser.id,
      employeeNumber: `COACHFEESALEBACKFILL-${Date.now()}`,
      firstName: TEST_USERNAME_PREFIX,
      lastName: "Coach",
      isCoach: true,
    },
  });
  await coachAvailabilityService.createWindow(
    {
      coachId: coach.id,
      startAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 7),
      endAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 22),
    },
    coach.id,
    owner.id,
  );

  try {
    // Raw inserts, bypassing every service — this simulates the exact
    // shape the 6 real production bookings had: a real BOOKING Sale
    // (court-only), a real non-cancelled CoachSession, and no COACHING
    // Sale at all.
    const startAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 9, 0);
    const endAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 10, 0);
    const booking = await prisma.booking.create({
      data: {
        bookingReference: `TCR-COACHFEESALEBACKFILL-${Date.now()}`,
        courtId: court.id,
        bookedById: owner.id,
        type: "HOURLY",
        status: "CONFIRMED",
        source: "PUBLIC",
        startAt,
        endAt,
        guestName: `${TEST_USERNAME_PREFIX}Guest`,
        totalAmountCents: 35000,
      },
    });
    const coachSession = await prisma.coachSession.create({
      data: {
        sessionReference: `CS-COACHFEESALEBACKFILL-${Date.now()}`,
        bookingId: booking.id,
        coachId: coach.id,
        bookedById: owner.id,
        groupSize: 1,
        rateCents: COACH_RATE_CENTS,
        status: "CONFIRMED",
        source: "PUBLIC",
      },
    });
    await prisma.sale.create({
      data: {
        saleNumber: `SALE-COACHFEESALEBACKFILL-${Date.now()}`,
        category: "BOOKING",
        source: "WEBSITE",
        amountCents: 35000,
        paymentMethodId: paymentMethod.id,
        employeeId: ownerEmployee.id,
        shiftId: shift.id,
        bookingId: booking.id,
      },
    });

    // A SECOND booking with a CANCELLED coach session — must never be
    // backfilled, since a cancelled session owes nothing.
    const booking2 = await prisma.booking.create({
      data: {
        bookingReference: `TCR-COACHFEESALEBACKFILL-CANCELLED-${Date.now()}`,
        courtId: court.id,
        bookedById: owner.id,
        type: "HOURLY",
        status: "CONFIRMED",
        source: "PUBLIC",
        startAt: new Date(startAt.getTime() + 60 * 60 * 1000),
        endAt: new Date(endAt.getTime() + 60 * 60 * 1000),
        guestName: `${TEST_USERNAME_PREFIX}Guest2`,
        totalAmountCents: 35000,
      },
    });
    await prisma.coachSession.create({
      data: {
        sessionReference: `CS-COACHFEESALEBACKFILL-CANCELLED-${Date.now()}`,
        bookingId: booking2.id,
        coachId: coach.id,
        bookedById: owner.id,
        groupSize: 1,
        rateCents: COACH_RATE_CENTS,
        status: "CANCELLED",
        source: "PUBLIC",
        cancelledAt: new Date(),
      },
    });
    await prisma.sale.create({
      data: {
        saleNumber: `SALE-COACHFEESALEBACKFILL-CANCELLED-${Date.now()}`,
        category: "BOOKING",
        source: "WEBSITE",
        amountCents: 35000,
        paymentMethodId: paymentMethod.id,
        employeeId: ownerEmployee.id,
        shiftId: shift.id,
        bookingId: booking2.id,
      },
    });

    // ============== Run 1: the real backfill ==============
    const results = await backfillCoachingFeeSales();
    const ourResult = results.find((r) => r.bookingReference === booking.bookingReference);
    assert(ourResult !== undefined, "expected our fixture booking to be backfilled");
    assert(
      ourResult!.amountCents === COACH_RATE_CENTS,
      `expected the backfilled amount to equal ${COACH_RATE_CENTS}, got ${ourResult!.amountCents}`,
    );
    console.log(`PASS: backfillCoachingFeeSales picked up the historical-shaped fixture and recorded ${ourResult!.amountCents} cents.`);

    const coachingSale = await prisma.sale.findUniqueOrThrow({ where: { coachSessionId: coachSession.id } });
    assert(coachingSale.category === "COACHING", `expected category COACHING, got ${coachingSale.category}`);
    assert(coachingSale.amountCents === COACH_RATE_CENTS, `expected amount ${COACH_RATE_CENTS}, got ${coachingSale.amountCents}`);
    assert(
      coachingSale.paymentMethodId === paymentMethod.id,
      "expected the backfilled Sale to use the same payment method the original court Sale used",
    );
    assert(
      coachingSale.employeeId === ownerEmployee.id,
      "expected the backfilled Sale to be attributed to the original settling staff member",
    );
    console.log("PASS: the backfilled COACHING Sale is categorized, linked, and attributed correctly.");

    const cancelledSessionSale = await prisma.sale.findFirst({
      where: { coachSession: { bookingId: booking2.id } },
    });
    assert(cancelledSessionSale === null, "expected a booking with a CANCELLED coach session to never be backfilled");
    console.log("PASS: a booking with a CANCELLED coach session is correctly skipped.");

    // ============== Run 2: idempotency ==============
    const results2 = await backfillCoachingFeeSales();
    const ourResult2 = results2.find((r) => r.bookingReference === booking.bookingReference);
    assert(ourResult2 === undefined, "expected a second run to find nothing left to backfill for our fixture booking");
    const saleCount = await prisma.sale.count({ where: { coachSessionId: coachSession.id } });
    assert(saleCount === 1, `expected exactly 1 COACHING Sale after two backfill runs (no duplicate), got ${saleCount}`);
    console.log("PASS: running the backfill a second time creates no duplicate — idempotent.");

    await cleanUp(court.id);
  } catch (error) {
    await cleanUp(court.id);
    throw error;
  }

  console.log(
    "\nPASS: backfillCoachingFeeSales correctly recovers historical missing coaching Sales, proven against real rows.",
  );
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
