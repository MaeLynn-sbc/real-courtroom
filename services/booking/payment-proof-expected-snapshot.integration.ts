/**
 * Batch 2 of the Bea Señeris investigation (BK-20260804-0002): Expected
 * was recomputed LIVE on every page load, so a coach added or removed
 * after a payment proof was submitted silently changed what the proof
 * was compared against, with no record of what it originally was.
 * BookingPaymentProof.expectedAmountCents now freezes
 * getExpectedPaymentTotalCents(booking) at submission, inside the same
 * transaction as submittedAmountCents.
 *
 * Proves, against real rows:
 *   1. The real divergence scenario this column exists to catch: submit
 *      a proof while a coach session is CONFIRMED (snapshot = court +
 *      coaching), then cancel the coach session afterward. The snapshot
 *      keeps reading the OLD (higher) total forever; a live
 *      recomputation from the same booking now reads the NEW (lower,
 *      court-only) total. They provably disagree.
 *   2. The approval gate is unaffected by this — it still compares
 *      against LIVE, unchanged, so a genuine current discrepancy still
 *      requires a reason even though the snapshot alone would have
 *      looked "fine" against her original payment.
 *   3. A pre-feature row (expectedAmountCents left null, simulating a
 *      proof submitted before this column existed) is fetchable via
 *      getProofById without error — null is a real, expected state, not
 *      a crash.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { getExpectedPaymentTotalCents } from "../../lib/booking-payment-total";
import { prisma } from "../../lib/prisma";
import { coachAvailabilityService } from "../coaching/coach-availability.service";
import { coachRateService } from "../coaching/coach-rate.service";
import { addPublicCoachToBooking } from "../coaching/public-coach-session";
import { coachSessionService } from "../coaching/coach-session.service";
import { settingsService } from "../settings/settings.service";
import { bookingPaymentProofService } from "./booking-payment-proof.service";
import { createPublicBooking } from "./public-booking.service";
import { getWebsiteBookingContext } from "./website-identity";

const TEST_DATE = new Date(2031, 6, 26); // Saturday, distinct from other integration fixtures' dates
const TEST_USERNAME_PREFIX = "it-snapshotdiverge-";
const COACH_RATE_CENTS = 60000; // ₱600, matching the real Bea Señeris booking

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
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
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });

  await cleanUp(court.id);

  const coachUsername = `${TEST_USERNAME_PREFIX}${Date.now()}`;
  const coachUser = await prisma.user.create({
    data: { name: "Snapshot Diverge Coach", username: coachUsername, roleId: role.id },
  });
  const coach = await prisma.employee.create({
    data: {
      userId: coachUser.id,
      employeeNumber: `SNAPDIVERGE-${Date.now()}`,
      firstName: "Snapshot",
      lastName: "Diverge",
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
  await coachRateService.upsertRate({ coachId: coach.id, groupSize: 1, priceCents: COACH_RATE_CENTS }, owner.id);

  try {
    await settingsService.setBookingRequirePrepayment(true, owner.id);

    // ============== 1 & 2: the real divergence scenario ==============
    const startAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 9, 0);
    const endAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 10, 0);
    const hold = await createPublicBooking({
      courtId: court.id,
      startAt,
      endAt,
      guestName: "Snapshot Diverge Guest",
      guestPhone: "09171110097",
    });
    const courtCents = hold.totalAmountCents ?? 0;

    const websiteContext = await getWebsiteBookingContext();
    const addCoachResult = await addPublicCoachToBooking(
      { bookingId: hold.bookingId, coachId: coach.id, groupSize: 1 },
      websiteContext.userId,
    );
    assert(addCoachResult.error === null, `expected the coach add-on to succeed, got: ${addCoachResult.error}`);
    const originalCombinedCents = courtCents + COACH_RATE_CENTS;

    // Submit while the coach session is still CONFIRMED — the snapshot
    // must freeze the combined total.
    const proof = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: hold.bookingId,
      gcashReference: `SNAPDIVERGE-${Date.now()}`,
      submittedAmountCents: originalCombinedCents,
      screenshot: screenshot(),
    });
    const proofAtSubmission = await bookingPaymentProofService.getProofById(proof.id);
    assert(proofAtSubmission !== null, "expected the just-submitted proof to be fetchable");
    assert(
      proofAtSubmission!.expectedAmountCents === originalCombinedCents,
      `expected the snapshot to equal ${originalCombinedCents} at submission, got ${proofAtSubmission!.expectedAmountCents}`,
    );
    console.log(
      `PASS: expectedAmountCents is frozen at ${proofAtSubmission!.expectedAmountCents} the instant the proof is submitted.`,
    );

    // Now cancel the coach session — the booking's LIVE total drops back
    // to court-only, but the snapshot must NOT change.
    const coachSessionRow = await prisma.coachSession.findFirstOrThrow({ where: { bookingId: hold.bookingId } });
    await coachSessionService.cancelCoachSession(coachSessionRow.id, owner.id, "Test cancellation");

    const proofAfterCancel = await bookingPaymentProofService.getProofById(proof.id);
    assert(proofAfterCancel !== null, "expected the proof to still be fetchable after the coach session is cancelled");
    assert(
      proofAfterCancel!.expectedAmountCents === originalCombinedCents,
      `expected the snapshot to STAY at ${originalCombinedCents} after the coach session was cancelled, got ${proofAfterCancel!.expectedAmountCents}`,
    );
    const liveExpectedAfterCancel = getExpectedPaymentTotalCents(proofAfterCancel!.booking);
    assert(
      liveExpectedAfterCancel === courtCents,
      `expected the LIVE total to drop to court-only (${courtCents}) after cancellation, got ${liveExpectedAfterCancel}`,
    );
    assert(
      proofAfterCancel!.expectedAmountCents !== liveExpectedAfterCancel,
      "expected the frozen snapshot and the live recomputation to now genuinely disagree",
    );
    console.log(
      `PASS: after cancelling the coach session, the snapshot still reads ${proofAfterCancel!.expectedAmountCents} (what she was actually asked to pay) while the live total reads ${liveExpectedAfterCancel} (what's currently owed) — they provably disagree, exactly the case this column exists to catch.`,
    );

    // The approval gate compares against LIVE, unchanged — she paid the
    // ORIGINAL combined amount, which now exceeds what's currently
    // (correctly) owed, so it's flagged as a mismatch requiring a
    // reason, not silently approved just because it matches the snapshot.
    let rejectedAsExpected = false;
    try {
      await bookingPaymentProofService.approveBookingPaymentProof(proof.id, {
        employeeId: ownerEmployee.id,
        shiftId: (await prisma.shift.findFirst({ where: { employeeId: ownerEmployee.id, status: "OPEN" } }))!.id,
        paymentMethodId: (await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } })).id,
        actorUserId: owner.id,
      });
    } catch (error) {
      rejectedAsExpected = error instanceof Error && error.message.includes("A reason is required");
    }
    assert(
      rejectedAsExpected,
      "expected the approval gate to still block on the LIVE total, even though the snapshot alone would have matched what she paid",
    );
    console.log(
      "PASS: the approval gate keeps comparing against LIVE, unchanged — a real current discrepancy still requires a reason.",
    );

    await cleanUp(court.id, coach.id);

    // ============== 3: null snapshot falls back cleanly ==============
    await cleanUp(court.id, coach.id);
    const holdB = await createPublicBooking({
      courtId: court.id,
      startAt,
      endAt,
      guestName: "Pre-Feature Guest",
      guestPhone: "09171110096",
    });
    const proofB = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: holdB.bookingId,
      gcashReference: `PREFEATURE-${Date.now()}`,
      submittedAmountCents: holdB.totalAmountCents ?? 0,
      screenshot: screenshot(),
    });
    // Simulate a row from before this column existed.
    await prisma.bookingPaymentProof.update({ where: { id: proofB.id }, data: { expectedAmountCents: null } });

    const proofBFetched = await bookingPaymentProofService.getProofById(proofB.id);
    assert(proofBFetched !== null, "expected a proof with a null snapshot to still be fetchable without error");
    assert(
      proofBFetched!.expectedAmountCents === null,
      "expected the simulated pre-feature row to read null, not a crash or a guessed value",
    );
    const liveExpectedB = getExpectedPaymentTotalCents(proofBFetched!.booking);
    assert(
      liveExpectedB === (holdB.totalAmountCents ?? 0),
      "expected the live computation to work fine independently of the null snapshot",
    );
    console.log(
      "PASS: a pre-feature row (null snapshot) is fetchable without error and the live computation is unaffected.",
    );

    await cleanUp(court.id, coach.id);
  } catch (error) {
    await cleanUp(court.id, coach.id);
    throw error;
  } finally {
    await settingsService.setBookingRequirePrepayment(true, owner.id);
  }

  console.log(
    "\nPASS: BookingPaymentProof.expectedAmountCents freezes at submission and genuinely diverges from the live total once the booking changes, proven against real rows.",
  );
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
