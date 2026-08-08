/**
 * Owner request (2026-08-09), from the Coaching report: "we should be
 * the one to put the collected and... choose source of funds." A
 * coaching Sale is otherwise only ever created automatically, as a side
 * effect of settling the underlying court booking — a CoachSession
 * attached to a booking that never went through that path has no Sale at
 * all, and (before this) nothing anywhere could create one after the
 * fact.
 *
 * Proves, against real rows:
 *   1. A CONFIRMED session with no Sale appears in
 *      getUncollectedCoachSessionsReport.
 *   2. markSessionCollected creates a real COACHING Sale (using the
 *      session's own snapshotted rateCents, not a re-typed amount), sets
 *      CoachSession.status to PAID, writes a CoachSessionHistory row, and
 *      audit-logs the Sale creation.
 *   3. The now-collected session drops out of
 *      getUncollectedCoachSessionsReport.
 *   4. A CANCELLED session can't be marked collected.
 *   5. An already-PAID session can't be marked collected again (no
 *      duplicate Sale — Sale.coachSessionId is @unique as a backstop).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService, type CreateBookingSaleContext } from "../booking/booking.service";
import { reportingService } from "../reporting/reporting.service";
import { coachRateService } from "./coach-rate.service";
import { coachSessionService } from "./coach-session.service";

const TEST_DATE = new Date(2031, 7, 14); // Thursday, isolated from other coaching fixtures' dates
const TEST_USERNAME_PREFIX = "it-markcollected-";

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
  await prisma.coachRate.deleteMany({ where: { coachId: { in: employeeIds } } });
  await prisma.employee.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function createUnpaidSession(
  court: { id: string },
  coach: { id: string },
  owner: { id: string },
  saleContext: CreateBookingSaleContext,
  hour: number,
) {
  const { startAt, endAt } = slot(hour);
  const booking = await bookingService.createBooking(
    { courtId: court.id, type: "HOURLY", startAt, endAt, guestName: `Uncollected Guest ${hour}` },
    owner.id,
    saleContext,
  );
  // isOutsideAvailability skips needing a real CoachAvailabilityWindow
  // fixture — a staff-only override, exactly like every other STAFF-path
  // coaching integration test that doesn't care about availability itself.
  const session = await coachSessionService.createCoachSession(
    { bookingId: booking.id, coachId: coach.id, groupSize: 1, isOutsideAvailability: true },
    "STAFF",
    owner.id,
  );
  return session;
}

async function main(): Promise<void> {
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

  await cleanUp(court.id);

  const ts = Date.now();
  const role = await prisma.role.findFirstOrThrow({ where: { name: "COURT_ATTENDANT" } });
  const coachUser = await prisma.user.create({
    data: { name: `${TEST_USERNAME_PREFIX}${ts}`, username: `${TEST_USERNAME_PREFIX}${ts}`, roleId: role.id },
  });
  const coach = await prisma.employee.create({
    data: {
      userId: coachUser.id,
      employeeNumber: `${TEST_USERNAME_PREFIX}${ts}-num`,
      firstName: "Uncollected",
      lastName: "Coach",
      isCoach: true,
    },
  });
  await coachRateService.upsertRate({ coachId: coach.id, groupSize: 1, priceCents: 60000 }, owner.id);

  let shift = await prisma.shift.findFirst({ where: { employeeId: ownerEmployee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-MARKCOLLECTED-${ts}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }
  const saleContext = { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id } as CreateBookingSaleContext;

  const range = { from: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate()), to: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate() + 1) };

  try {
    // ============== 1 & 2. Uncollected session surfaces in the report; markSessionCollected fixes it for real ==============
    const session1 = await createUnpaidSession(court, coach, owner, saleContext, 9);

    const before = await reportingService.getUncollectedCoachSessionsReport(range);
    assert(
      before.some((row) => row.id === session1.id),
      "expected the fresh CONFIRMED, no-Sale session to appear in getUncollectedCoachSessionsReport",
    );
    console.log("PASS: a CONFIRMED session with no Sale appears in the uncollected-sessions report.");

    const updated = await coachSessionService.markSessionCollected(
      session1.id,
      cashMethod.id,
      ownerEmployee.id,
      shift.id,
      owner.id,
    );
    assert(updated.status === "PAID", `expected status PAID after marking collected, got ${updated.status}`);

    const sale = await prisma.sale.findUnique({ where: { coachSessionId: session1.id } });
    assert(sale, "expected a real Sale row linked to the session");
    assert(sale!.category === "COACHING", `expected category COACHING, got ${sale!.category}`);
    assert(
      sale!.amountCents === session1.rateCents,
      `expected the Sale amount to match the session's own snapshotted rateCents (${session1.rateCents}), got ${sale!.amountCents}`,
    );
    assert(sale!.paymentMethodId === cashMethod.id, "expected the chosen CASH payment method on the Sale");

    const history = await prisma.coachSessionHistory.findFirst({
      where: { coachSessionId: session1.id, status: "PAID" },
    });
    assert(history, "expected a CoachSessionHistory row recording the PAID transition");

    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "Sale", entityId: sale!.id, action: "sale.created" },
    });
    assert(auditEntry, "expected a sale.created audit log entry for the manually-recorded Sale");
    console.log(
      "PASS: markSessionCollected creates a real COACHING Sale (session's own fee, chosen method), sets status PAID, and audit-logs it.",
    );

    // ============== 3. Drops out of the uncollected-sessions report once collected ==============
    const after = await reportingService.getUncollectedCoachSessionsReport(range);
    assert(
      !after.some((row) => row.id === session1.id),
      "expected the now-collected session to no longer appear in getUncollectedCoachSessionsReport",
    );
    console.log("PASS: the session drops out of the uncollected-sessions report once collected.");

    // ============== 4. A CANCELLED session can't be marked collected ==============
    const session2 = await createUnpaidSession(court, coach, owner, saleContext, 11);
    await coachSessionService.cancelCoachSession(session2.id, owner.id);
    let cancelledRejected = false;
    try {
      await coachSessionService.markSessionCollected(session2.id, cashMethod.id, ownerEmployee.id, shift.id, owner.id);
    } catch (error) {
      cancelledRejected = true;
      assert(String(error).includes("cancelled"), `expected a cancelled-session error, got ${error}`);
    }
    assert(cancelledRejected, "expected a CANCELLED session to be rejected");
    console.log("PASS: a cancelled session can't be marked collected.");

    // ============== 5. An already-PAID session can't be marked collected again ==============
    let alreadyPaidRejected = false;
    try {
      await coachSessionService.markSessionCollected(session1.id, cashMethod.id, ownerEmployee.id, shift.id, owner.id);
    } catch (error) {
      alreadyPaidRejected = true;
      assert(String(error).includes("already"), `expected an already-collected error, got ${error}`);
    }
    assert(alreadyPaidRejected, "expected an already-PAID session to be rejected on a second attempt");
    const saleCountAfterSecondAttempt = await prisma.sale.count({ where: { coachSessionId: session1.id } });
    assert(saleCountAfterSecondAttempt === 1, `expected exactly one Sale to ever exist for the session, found ${saleCountAfterSecondAttempt}`);
    console.log("PASS: an already-collected session can't be marked collected again — no duplicate Sale.");

    console.log(
      "\nPASS: manual coaching-session payment collection proven against real rows — genuinely new capability, not just a reporting fix.",
    );
  } finally {
    await cleanUp(court.id);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
