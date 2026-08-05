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
 * 2. Stale-hold behavior (REVISED 2026-08-03 — see
 *    checkAvailabilityWithClient's own comment in booking.service.ts for
 *    the real incident that reversed this). This scenario used to prove
 *    a coach session attached to a silently-expired, unresolved hold
 *    must NOT block a fresh attempt at the same coach/time — because
 *    back then, an expired AWAITING_PAYMENT hold stopped blocking its
 *    COURT too, so a second customer really could book straight over it.
 *    That premise no longer holds: a stale hold now blocks its court
 *    indefinitely until staff explicitly cancel it, so a second overlapping
 *    booking attempt correctly fails before a coach is ever in the
 *    picture. This now proves the coherent replacement chain instead: the
 *    coach session on a stale, unresolved hold keeps correctly blocking
 *    that coach's time (consistent with the court itself still being
 *    blocked) — right up until staff explicitly cancel the stale
 *    booking, which cascades CANCELLED onto the coach session (same
 *    cascade as gap 1), and ONLY THEN does a fresh booking + coach
 *    attachment for that slot succeed.
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
import { addPublicCoachToBooking } from "./public-coach-session";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachRateService } from "./coach-rate.service";

const TEST_DATE = new Date(2031, 6, 11); // Friday, distinct from other integration fixtures' dates
const TEST_USERNAME_PREFIX = "it-phase8coach-";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function slot(hour: number): { startAt: Date; endAt: Date } {
  const startAt = new Date(
    TEST_DATE.getFullYear(),
    TEST_DATE.getMonth(),
    TEST_DATE.getDate(),
    hour,
    0,
  );
  const endAt = new Date(
    TEST_DATE.getFullYear(),
    TEST_DATE.getMonth(),
    TEST_DATE.getDate(),
    hour + 1,
    0,
  );
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
  await prisma.coachSessionHistory.deleteMany({
    where: { coachSession: { bookingId: { in: bookingIds } } },
  });
  await prisma.coachSession.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.sale.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingPaymentProof.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });

  if (coachId) {
    await prisma.coachAvailabilityWindow.deleteMany({ where: { coachId } });
    await prisma.coachRate.deleteMany({ where: { coachId } });
  }
  const users = await prisma.user.findMany({
    where: { username: { startsWith: TEST_USERNAME_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const employeeIds = employees.map((e) => e.id);
  await prisma.coachAvailabilityWindow.deleteMany({ where: { coachId: { in: employeeIds } } });
  await prisma.coachRate.deleteMany({ where: { coachId: { in: employeeIds } } });
  await prisma.employee.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main(): Promise<void> {
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const role = await prisma.role.findFirstOrThrow({ where: { name: "COURT_ATTENDANT" } });

  await cleanUp(court.id);

  const coachUsername = `${TEST_USERNAME_PREFIX}${Date.now()}`;
  const coachUser = await prisma.user.create({
    data: { name: "Phase8 Interaction Coach", username: coachUsername, roleId: role.id },
  });
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
  await coachRateService.upsertRate(
    { coachId: coach.id, groupSize: 1, priceCents: 40000 },
    owner.id,
  );

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
    assert(
      addCoachResult.error === null,
      `expected the coach add-on to succeed on a live hold, got: ${addCoachResult.error}`,
    );
    assert(addCoachResult.coachSessionId, "expected a coachSessionId back");
    console.log(
      "PASS: a coach can be attached to a booking that's still an AWAITING_PAYMENT hold.",
    );

    const proof = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: rejectHold.bookingId,
      gcashReference: `PHASE8COACH-REJ-${Date.now()}`,
      submittedAmountCents: 35000,
      screenshot: screenshot(),
    });
    await bookingPaymentProofService.rejectBookingPaymentProof(
      proof.id,
      "Screenshot doesn't show a completed transaction.",
      {
        employeeId: (await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } })).id,
        actorUserId: owner.id,
      },
    );

    const bookingAfterReject = await prisma.booking.findUniqueOrThrow({
      where: { id: rejectHold.bookingId },
    });
    assert(
      bookingAfterReject.status === "REJECTED",
      `expected REJECTED, got ${bookingAfterReject.status}`,
    );

    const coachSessionAfterReject = await prisma.coachSession.findUniqueOrThrow({
      where: { id: addCoachResult.coachSessionId },
    });
    console.log(
      `After rejection: booking.status=${bookingAfterReject.status}, coachSession.status=${coachSessionAfterReject.status}`,
    );
    assert(
      coachSessionAfterReject.status === "CANCELLED",
      `expected the coach session to cascade to CANCELLED on rejection, got ${coachSessionAfterReject.status}`,
    );
    assert(
      coachSessionAfterReject.cancelledAt !== null,
      "expected cancelledAt stamped on the cascaded cancellation",
    );

    const historyAfterReject = await prisma.coachSessionHistory.findMany({
      where: { coachSessionId: addCoachResult.coachSessionId },
      orderBy: { createdAt: "desc" },
    });
    assert(
      historyAfterReject[0]?.status === "CANCELLED",
      "expected a CoachSessionHistory row recording the cascade",
    );
    console.log(
      "PASS: rejecting the payment proof cascaded CANCELLED onto its coach session, same as the CANCELLED-booking cascade.",
    );

    // ============== GAP 2: stale-hold behavior (revised) ==============
    const staleSlot = slot(14);
    const staleHold = await createPublicBooking({
      courtId: court.id,
      startAt: staleSlot.startAt,
      endAt: staleSlot.endAt,
      guestName: "Stale Hold Guest",
      guestPhone: "09171110010",
    });
    const staleCoachResult = await addPublicCoachToBooking(
      { bookingId: staleHold.bookingId, coachId: coach.id, groupSize: 1 },
      websiteContext.userId,
    );
    assert(
      staleCoachResult.error === null,
      `expected the coach add-on to succeed, got: ${staleCoachResult.error}`,
    );

    // Nobody ever resolves this hold — no submit, no reject, no cancel.
    // Simulate real elapsed time the way the switch-on test simulates a
    // rejection: force holdExpiresAt into the past directly, since
    // waiting 30 real minutes isn't practical in a test.
    await prisma.booking.update({
      where: { id: staleHold.bookingId },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });
    const stillConfirmedSession = await prisma.coachSession.findUniqueOrThrow({
      where: { id: staleCoachResult.coachSessionId },
    });
    assert(
      stillConfirmedSession.status === "CONFIRMED",
      "expected the coach session to still read CONFIRMED — nothing actively sweeps a stale hold, by design",
    );
    console.log(
      "Hold gone stale (holdExpiresAt backdated, booking.status untouched) — coach session still CONFIRMED, as expected.",
    );

    // A fresh booking attempt at the SAME court/time must now correctly
    // FAIL — the stale hold still blocks its court (2026-08-03 reversal,
    // see this file's own header comment). This is the coherent
    // replacement for the old "silently released" expectation.
    let blockedAttemptError: unknown = null;
    try {
      await createPublicBooking({
        courtId: court.id,
        startAt: staleSlot.startAt,
        endAt: staleSlot.endAt,
        guestName: "Blocked Second Attempt Guest",
        guestPhone: "09171110011",
      });
    } catch (error) {
      blockedAttemptError = error;
    }
    assert(
      blockedAttemptError !== null,
      "expected a fresh booking on the same slot to be rejected — the stale hold must still block its court",
    );
    console.log(
      "PASS: a stale, unresolved hold still blocks a fresh booking attempt on the same court/time.",
    );

    // Only an explicit staff cancellation releases it — and that cascade
    // (already proven standalone in coach-session-cancellation-cascade.
    // integration.ts) correctly reaches the attached coach session too.
    await bookingService.updateBookingStatus(staleHold.bookingId, "CANCELLED", owner.id);
    const cancelledSession = await prisma.coachSession.findUniqueOrThrow({
      where: { id: staleCoachResult.coachSessionId },
    });
    assert(
      cancelledSession.status === "CANCELLED",
      `expected staff cancelling the stale hold to cascade CANCELLED onto its coach session, got ${cancelledSession.status}`,
    );
    console.log(
      "PASS: staff explicitly cancelling the stale hold cascades CANCELLED onto its coach session.",
    );

    // NOW a fresh booking + coach attachment for that same slot succeeds
    // — genuinely unblocked, not silently unblocked.
    const freshHold = await createPublicBooking({
      courtId: court.id,
      startAt: staleSlot.startAt,
      endAt: staleSlot.endAt,
      guestName: "Genuinely Fresh Attempt Guest",
      guestPhone: "09171110012",
    });
    const freshCoachResult = await addPublicCoachToBooking(
      { bookingId: freshHold.bookingId, coachId: coach.id, groupSize: 1 },
      websiteContext.userId,
    );
    console.log(
      `Fresh attachment attempt at the same coach/time, after explicit cancellation: error=${freshCoachResult.error}`,
    );
    assert(
      freshCoachResult.error === null,
      `expected a coach session attach to succeed once the stale hold is explicitly cancelled, got: ${freshCoachResult.error}`,
    );
    console.log(
      "PASS: once staff explicitly cancel the stale hold, a fresh booking and coach attachment for that slot succeed.",
    );

    await cleanUp(court.id, coach.id);
    console.log(
      "\nPASS: Coaching x Phase 8 interaction proven — both merge-time gaps fixed and verified against real rows.",
    );
  } finally {
    // Restore the real deploy default (true — see
    // getBookingRequirePrepayment's own comment), not the old off
    // default.
    await settingsService.setBookingRequirePrepayment(true, owner.id);
    const restored = await settingsService.getBookingRequirePrepayment();
    console.log(`Switch restored to ON (verified: ${restored === true}).`);
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
