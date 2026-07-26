/**
 * Merge-time proof (Coaching x Phase 8, merged into main together):
 * neither feature may silently disable the other on the same booking.
 * Two real gaps were found while resolving the merge and are proven
 * fixed here, both against the actual public flow, not a shortcut:
 *
 * 1. REJECTED cascade. booking.service.ts's updateBookingStatus already
 *    cascades CANCELLED onto an attached CoachSession (see
 *    coach-session-cancellation-cascade.integration.ts) — but Phase 8's
 *    rejectBookingPaymentProof sets status via its own direct
 *    tx.booking.update, never through updateBookingStatus, so it never
 *    inherited that cascade. Without the fix, a coach attached to a
 *    since-rejected hold would stay CONFIRMED forever, permanently
 *    occupying that coach's calendar for a court booking that never
 *    happened.
 *
 * 2. Expired-hold exclusion. createCoachSession's own double-booking
 *    check queried every non-CANCELLED/NO_SHOW CoachSession with no
 *    regard for its parent booking's status at all — so a coach session
 *    attached to a hold that simply expired unresolved (no reject, no
 *    cancel — Phase 8's own "lazy exclusion, no active sweep" design
 *    means nothing ever transitions that booking's status) would falsely
 *    block that coach's time forever. Fixed by mirroring
 *    checkAvailabilityWithClient's own parent-booking exclusion.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingPaymentProofService } from "../booking/booking-payment-proof.service";
import { createPublicBooking } from "../booking/public-booking.service";
import { getWebsiteBookingContext } from "../booking/website-identity";
import { settingsService } from "../settings/settings.service";
import { addPublicCoachToBooking } from "./public-coach-session";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachRateService } from "./coach-rate.service";
import { coachSessionService } from "./coach-session.service";

const TEST_DATE = new Date(2031, 6, 11); // Friday, distinct from other integration fixtures' dates
const TEST_USERNAME_PREFIX = "it-phase8coach-";

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

function screenshot() {
  return { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") };
}

async function cleanUp(courtId: string, coachId?: string): Promise<void> {
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
  await prisma.bookingPaymentProof.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });

  if (coachId) {
    await prisma.coachAvailabilityWindow.deleteMany({ where: { coachId } });
    await prisma.coachRate.deleteMany({ where: { coachId } });
  }
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
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });

  await cleanUp(court.id);

  const coachUsername = `${TEST_USERNAME_PREFIX}${Date.now()}`;
  const coachUser = await prisma.user.create({ data: { name: "Phase8 Interaction Coach", username: coachUsername, roleId: role.id } });
  const coach = await prisma.employee.create({
    data: {
      userId: coachUser.id,
      employeeNumber: `PHASE8COACH-${Date.now()}`,
      firstName: "Phase8",
      lastName: "Coach",
      isCoach: true,
    },
  });
  await coachAvailabilityService.createWindow(
    {
      coachId: coach.id,
      startAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 7),
      endAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 20),
    },
    coach.id,
    owner.id,
  );
  await coachRateService.upsertRate({ coachId: coach.id, groupSize: 1, priceCents: 40000 }, owner.id);

  try {
    await settingsService.setBookingRequirePrepayment(true, owner.id);
    console.log("Switch turned ON for this test.");

    // ============== GAP 1: REJECTED cascade ==============
    const rejectSlot = slot(9);
    const rejectHold = await createPublicBooking({
      courtId: court.id,
      startAt: rejectSlot.startAt,
      endAt: rejectSlot.endAt,
      guestName: "Reject Cascade Guest",
      guestPhone: "09171110009",
    });
    assert(rejectHold.requiresPayment === true, "expected the hold to require payment");

    const websiteContext = await getWebsiteBookingContext();
    const addCoachResult = await addPublicCoachToBooking(
      { bookingId: rejectHold.bookingId, coachId: coach.id, groupSize: 1 },
      websiteContext.userId,
    );
    assert(addCoachResult.error === null, `expected the coach add-on to succeed on a live hold, got: ${addCoachResult.error}`);
    assert(addCoachResult.coachSessionId, "expected a coachSessionId back");
    console.log("PASS: a coach can be attached to a booking that's still an AWAITING_PAYMENT hold.");

    const proof = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: rejectHold.bookingId,
      gcashReference: `PHASE8COACH-REJ-${Date.now()}`,
      submittedAmountCents: 35000,
      screenshot: screenshot(),
    });
    await bookingPaymentProofService.rejectBookingPaymentProof(
      proof.id,
      "Screenshot doesn't show a completed transaction.",
      { employeeId: (await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } })).id, actorUserId: owner.id },
    );

    const bookingAfterReject = await prisma.booking.findUniqueOrThrow({ where: { id: rejectHold.bookingId } });
    assert(bookingAfterReject.status === "REJECTED", `expected REJECTED, got ${bookingAfterReject.status}`);

    const coachSessionAfterReject = await prisma.coachSession.findUniqueOrThrow({
      where: { id: addCoachResult.coachSessionId },
    });
    console.log(`After rejection: booking.status=${bookingAfterReject.status}, coachSession.status=${coachSessionAfterReject.status}`);
    assert(
      coachSessionAfterReject.status === "CANCELLED",
      `expected the coach session to cascade to CANCELLED on rejection, got ${coachSessionAfterReject.status}`,
    );
    assert(coachSessionAfterReject.cancelledAt !== null, "expected cancelledAt stamped on the cascaded cancellation");

    const historyAfterReject = await prisma.coachSessionHistory.findMany({
      where: { coachSessionId: addCoachResult.coachSessionId },
      orderBy: { createdAt: "desc" },
    });
    assert(historyAfterReject[0]?.status === "CANCELLED", "expected a CoachSessionHistory row recording the cascade");
    console.log("PASS: rejecting the payment proof cascaded CANCELLED onto its coach session, same as the CANCELLED-booking cascade.");

    // ============== GAP 2: expired-hold exclusion ==============
    const expiredSlot = slot(14);
    const expiredHold = await createPublicBooking({
      courtId: court.id,
      startAt: expiredSlot.startAt,
      endAt: expiredSlot.endAt,
      guestName: "Silently Expired Guest",
      guestPhone: "09171110010",
    });
    const expiredCoachResult = await addPublicCoachToBooking(
      { bookingId: expiredHold.bookingId, coachId: coach.id, groupSize: 1 },
      websiteContext.userId,
    );
    assert(expiredCoachResult.error === null, `expected the coach add-on to succeed, got: ${expiredCoachResult.error}`);

    // Nobody ever resolves this hold — no submit, no reject, no cancel.
    // Simulate real elapsed time the way the switch-on test simulates a
    // rejection: force holdExpiresAt into the past directly, since
    // waiting 30 real minutes isn't practical in a test.
    await prisma.booking.update({
      where: { id: expiredHold.bookingId },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });
    const stillConfirmedSession = await prisma.coachSession.findUniqueOrThrow({
      where: { id: expiredCoachResult.coachSessionId },
    });
    assert(
      stillConfirmedSession.status === "CONFIRMED",
      "expected the coach session to still read CONFIRMED — nothing actively sweeps an expired hold, by design",
    );
    console.log("Hold silently expired (holdExpiresAt backdated, booking.status untouched) — coach session still CONFIRMED, as expected.");

    // A second, fresh booking for the SAME coach at an OVERLAPPING time.
    // Before the fix, createCoachSession's conflict query would have
    // found the still-CONFIRMED session above and wrongly rejected this.
    const overlappingHold = await createPublicBooking({
      courtId: court.id,
      startAt: expiredSlot.startAt,
      endAt: expiredSlot.endAt,
      guestName: "Second Attempt Guest",
      guestPhone: "09171110011",
    });
    const secondCoachResult = await addPublicCoachToBooking(
      { bookingId: overlappingHold.bookingId, coachId: coach.id, groupSize: 1 },
      websiteContext.userId,
    );
    console.log(`Second attachment attempt at the same coach/time result: error=${secondCoachResult.error}`);
    assert(
      secondCoachResult.error === null,
      `expected a coach session attached to a since-expired hold to NOT block a fresh attempt, got: ${secondCoachResult.error}`,
    );
    console.log("PASS: a coach session on an expired, unresolved hold no longer falsely blocks that coach's time for a new booking.");

    await cleanUp(court.id, coach.id);
    console.log("\nPASS: Coaching x Phase 8 interaction proven — both merge-time gaps fixed and verified against real rows.");
  } finally {
    await settingsService.setBookingRequirePrepayment(false, owner.id);
    const restored = await settingsService.getBookingRequirePrepayment();
    console.log(`Switch restored to OFF (verified: ${restored === false}).`);
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
