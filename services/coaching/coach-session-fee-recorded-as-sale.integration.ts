/**
 * Batch 3 of the Bea Señeris investigation (BK-20260804-0002): a coach
 * session's fee was never recorded ANYWHERE once a booking got paid —
 * neither approveBookingPaymentProof nor settleBooking referenced
 * coachSession at all, both creating exactly one Sale for court hire
 * only. Confirmed live against production: 7 real bookings with a
 * non-cancelled coach session and CONFIRMED+ status, 6 with a Sale —
 * every one of those 6 recorded only the court amount. ₱3,000.00 in
 * coaching fees collected from real customers, never recorded anywhere.
 *
 * Owner decision (2026-08-04): the coach's session fee is its own Sale,
 * category COACHING, linked via Sale.coachSessionId — both already
 * existed in the schema (reserved, unused, since coaching sessions
 * first launched) and reporting.service.ts already queries category
 * COACHING for its coaching-revenue figure. Paying the coach their
 * share afterward is a separate, manual step the owner does themselves
 * (an Expense, entered by hand at actual payout time) — nothing in this
 * flow creates one automatically.
 *
 * Proves, against real rows:
 *   1. Approving a GCash payment proof for a booking with a coach
 *      session creates TWO Sales — one BOOKING (court only, unchanged)
 *      and one COACHING (the coach's full session fee, linked via
 *      coachSessionId).
 *   2. Staff settling a booking at the venue (cash) with a coach
 *      session does the same.
 *   3. A booking with NO coach session creates only the one BOOKING
 *      Sale — this mechanism only ever fires when there's a real fee
 *      to record.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "../booking/booking.service";
import { bookingPaymentProofService } from "../booking/booking-payment-proof.service";
import { createPublicBooking } from "../booking/public-booking.service";
import { getWebsiteBookingContext } from "../booking/website-identity";
import { settingsService } from "../settings/settings.service";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachRateService } from "./coach-rate.service";
import { addPublicCoachToBooking } from "./public-coach-session";

const TEST_DATE = new Date(2031, 6, 28); // Sunday, distinct from other integration fixtures' dates
const TEST_USERNAME_PREFIX = "it-coachfeesale-";
const COACH_RATE_CENTS = 60000; // ₱600, matching the real Bea Señeris booking

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function screenshot() {
  return { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") };
}

async function cleanUp(courtIds: string[]): Promise<void> {
  const dayStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const bookings = await prisma.booking.findMany({
    where: { courtId: { in: courtIds }, startAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  const bookingIds = bookings.map((b) => b.id);
  await prisma.coachSessionHistory.deleteMany({ where: { coachSession: { bookingId: { in: bookingIds } } } });
  await prisma.sale.deleteMany({
    where: { OR: [{ bookingId: { in: bookingIds } }, { coachSession: { bookingId: { in: bookingIds } } }] },
  });
  await prisma.coachSession.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingPaymentProof.deleteMany({ where: { bookingId: { in: bookingIds } } });
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
  const otherCourt = await prisma.court.findFirstOrThrow({ where: { deletedAt: null, id: { not: court.id } } });
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });

  let shift = await prisma.shift.findFirst({ where: { employeeId: ownerEmployee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-COACHFEESALE-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

  await cleanUp([court.id, otherCourt.id]);

  const coachUsername = `${TEST_USERNAME_PREFIX}${Date.now()}`;
  const coachUser = await prisma.user.create({
    data: { name: `${TEST_USERNAME_PREFIX}Coach`, username: coachUsername, roleId: role.id },
  });
  const coach = await prisma.employee.create({
    data: {
      userId: coachUser.id,
      employeeNumber: `COACHFEESALE-${Date.now()}`,
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
  await coachRateService.upsertRate({ coachId: coach.id, groupSize: 1, priceCents: COACH_RATE_CENTS }, owner.id);

  try {
    await settingsService.setBookingRequirePrepayment(true, owner.id);

    // ============== 1. Approval path ==============
    const startAt1 = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 9, 0);
    const endAt1 = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 10, 0);
    const hold1 = await createPublicBooking({
      courtId: court.id,
      startAt: startAt1,
      endAt: endAt1,
      guestName: `${TEST_USERNAME_PREFIX}Guest1`,
      guestPhone: "09171110093",
    });
    const courtCents1 = hold1.totalAmountCents ?? 0;
    const websiteContext = await getWebsiteBookingContext();
    const addCoach1 = await addPublicCoachToBooking(
      { bookingId: hold1.bookingId, coachId: coach.id, groupSize: 1 },
      websiteContext.userId,
    );
    assert(addCoach1.error === null, `expected the coach add-on to succeed, got: ${addCoach1.error}`);
    const combined1 = courtCents1 + COACH_RATE_CENTS;

    const proof1 = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: hold1.bookingId,
      gcashReference: `COACHFEESALE-APPROVE-${Date.now()}`,
      submittedAmountCents: combined1,
      screenshot: screenshot(),
    });
    const approveResult = await bookingPaymentProofService.approveBookingPaymentProof(proof1.id, {
      employeeId: ownerEmployee.id,
      shiftId: shift.id,
      paymentMethodId: gcashMethod.id,
      actorUserId: owner.id,
    });
    assert(!approveResult.alreadyResolved, "expected a real approval");

    const salesAfterApprove = await prisma.sale.findMany({
      where: { OR: [{ bookingId: hold1.bookingId }, { coachSession: { bookingId: hold1.bookingId } }] },
    });
    assert(salesAfterApprove.length === 2, `expected exactly 2 Sales after approval, got ${salesAfterApprove.length}`);
    const bookingSale1 = salesAfterApprove.find((s) => s.category === "BOOKING");
    const coachingSale1 = salesAfterApprove.find((s) => s.category === "COACHING");
    assert(bookingSale1 !== undefined, "expected a BOOKING-category Sale");
    assert(
      bookingSale1!.amountCents === courtCents1,
      `expected the BOOKING Sale to stay court-only (${courtCents1}), got ${bookingSale1!.amountCents}`,
    );
    assert(coachingSale1 !== undefined, "expected a COACHING-category Sale");
    assert(
      coachingSale1!.amountCents === COACH_RATE_CENTS,
      `expected the COACHING Sale to equal the coach's full rate (${COACH_RATE_CENTS}), got ${coachingSale1!.amountCents}`,
    );
    assert(coachingSale1!.coachSessionId !== null, "expected the COACHING Sale to be linked via coachSessionId");
    console.log(
      `PASS: approving a payment proof creates two Sales — BOOKING (${bookingSale1!.amountCents}, court-only) and COACHING (${coachingSale1!.amountCents}, the coach's full fee).`,
    );

    // ============== 2. Settlement path ==============
    const startAt2 = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 12, 0);
    const endAt2 = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 13, 0);
    const booking2 = await bookingService.createBooking(
      { courtId: otherCourt.id, type: "HOURLY", startAt: startAt2, endAt: endAt2, guestName: `${TEST_USERNAME_PREFIX}Guest2` },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shift.id },
    );
    const courtCents2 = booking2.totalAmountCents ?? 0;
    await addPublicCoachToBooking({ bookingId: booking2.id, coachId: coach.id, groupSize: 1 }, owner.id);

    await bookingService.settleBooking(
      booking2.id,
      "CASH",
      null,
      { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
      owner.id,
    );

    const salesAfterSettle = await prisma.sale.findMany({
      where: { OR: [{ bookingId: booking2.id }, { coachSession: { bookingId: booking2.id } }] },
    });
    assert(salesAfterSettle.length === 2, `expected exactly 2 Sales after settlement, got ${salesAfterSettle.length}`);
    const bookingSale2 = salesAfterSettle.find((s) => s.category === "BOOKING");
    const coachingSale2 = salesAfterSettle.find((s) => s.category === "COACHING");
    assert(
      bookingSale2!.amountCents === courtCents2,
      `expected the settled BOOKING Sale to stay court-only (${courtCents2}), got ${bookingSale2!.amountCents}`,
    );
    assert(
      coachingSale2!.amountCents === COACH_RATE_CENTS,
      `expected the settled COACHING Sale to equal the coach's full rate (${COACH_RATE_CENTS}), got ${coachingSale2!.amountCents}`,
    );
    console.log(
      `PASS: settling a booking at the venue creates two Sales — BOOKING (${bookingSale2!.amountCents}, court-only) and COACHING (${coachingSale2!.amountCents}, the coach's full fee).`,
    );

    // ============== 3. No coach session, no COACHING sale ==============
    const startAt3 = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 15, 0);
    const endAt3 = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 16, 0);
    const booking3 = await bookingService.createBooking(
      { courtId: court.id, type: "HOURLY", startAt: startAt3, endAt: endAt3, guestName: `${TEST_USERNAME_PREFIX}Guest3` },
      owner.id,
      { employeeId: ownerEmployee.id, shiftId: shift.id },
    );
    await bookingService.settleBooking(
      booking3.id,
      "CASH",
      null,
      { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
      owner.id,
    );
    const salesForBooking3 = await prisma.sale.findMany({ where: { bookingId: booking3.id } });
    assert(
      salesForBooking3.length === 1 && salesForBooking3[0].category === "BOOKING",
      `expected exactly 1 BOOKING Sale and no COACHING Sale for a booking with no coach session, got ${salesForBooking3.length} Sale(s)`,
    );
    console.log("PASS: a booking with no coach session creates only the one BOOKING Sale.");

    await cleanUp([court.id, otherCourt.id]);
  } catch (error) {
    await cleanUp([court.id, otherCourt.id]);
    throw error;
  } finally {
    await settingsService.setBookingRequirePrepayment(true, owner.id);
  }

  console.log(
    "\nPASS: a coach's session fee is recorded as its own Sale (category COACHING) on both the approval and settlement paths, proven against real rows.",
  );
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
