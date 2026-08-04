/**
 * Reported live (Bea Señeris, BK-20260804-0002): the verification QUEUE
 * list showed Expected ₱350 (court only) while the DETAIL screen for the
 * exact same proof showed ₱950 (court + coaching) — two different
 * numbers for the same row. Root cause: listPendingProofs' own query
 * never fetched coachSession at all, so the queue page had no way to
 * compute the coaching-inclusive total even if it tried — it fell back
 * to reading Booking.totalAmountCents (court hire only) directly instead
 * of calling getExpectedPaymentTotalCents like the detail screen and the
 * approval check already do.
 *
 * Proves, against a real row: a pending proof on a booking with an
 * attached, non-cancelled coach session comes back from
 * listPendingProofs with coachSession populated, and
 * getExpectedPaymentTotalCents computed from THAT data equals the full
 * court + coaching total — the same number the detail screen and
 * approveBookingPaymentProof already agree on. Before the fix, this
 * fails because coachSession is undefined on the returned booking.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { getExpectedPaymentTotalCents } from "../../lib/booking-payment-total";
import { prisma } from "../../lib/prisma";
import { coachAvailabilityService } from "../coaching/coach-availability.service";
import { coachRateService } from "../coaching/coach-rate.service";
import { addPublicCoachToBooking } from "../coaching/public-coach-session";
import { settingsService } from "../settings/settings.service";
import { bookingPaymentProofService } from "./booking-payment-proof.service";
import { createPublicBooking } from "./public-booking.service";
import { getWebsiteBookingContext } from "./website-identity";

const TEST_DATE = new Date(2031, 6, 25); // Friday, distinct from other integration fixtures' dates
const TEST_USERNAME_PREFIX = "it-queuecoach-";
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
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });

  await cleanUp(court.id);

  const coachUsername = `${TEST_USERNAME_PREFIX}${Date.now()}`;
  const coachUser = await prisma.user.create({
    data: { name: "Queue Coach Test", username: coachUsername, roleId: role.id },
  });
  const coach = await prisma.employee.create({
    data: {
      userId: coachUser.id,
      employeeNumber: `QUEUECOACH-${Date.now()}`,
      firstName: "Queue",
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
  await coachRateService.upsertRate({ coachId: coach.id, groupSize: 1, priceCents: COACH_RATE_CENTS }, owner.id);

  try {
    await settingsService.setBookingRequirePrepayment(true, owner.id);

    const startAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 9, 0);
    const endAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 10, 0);
    const hold = await createPublicBooking({
      courtId: court.id,
      startAt,
      endAt,
      guestName: "Queue Coach Test Guest",
      guestPhone: "09171110098",
    });
    const courtCents = hold.totalAmountCents ?? 0;

    const websiteContext = await getWebsiteBookingContext();
    const addCoachResult = await addPublicCoachToBooking(
      { bookingId: hold.bookingId, coachId: coach.id, groupSize: 1 },
      websiteContext.userId,
    );
    assert(addCoachResult.error === null, `expected the coach add-on to succeed, got: ${addCoachResult.error}`);

    const combinedCents = courtCents + COACH_RATE_CENTS;
    const proof = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: hold.bookingId,
      gcashReference: `QUEUECOACH-${Date.now()}`,
      submittedAmountCents: combinedCents,
      screenshot: screenshot(),
    });

    const pendingProofs = await bookingPaymentProofService.listPendingProofs();
    const found = pendingProofs.find((p) => p.id === proof.id);
    assert(found !== undefined, "expected the submitted proof to appear in listPendingProofs");

    // The bug: coachSession was never fetched by this query at all.
    assert(
      found!.booking.coachSession !== undefined && found!.booking.coachSession !== null,
      "expected listPendingProofs to include the booking's coachSession — this is the exact field the queue list needs to compute the real Expected total",
    );
    assert(
      found!.booking.coachSession!.rateCents === COACH_RATE_CENTS,
      `expected the fetched coachSession.rateCents to be ${COACH_RATE_CENTS}, got ${found!.booking.coachSession!.rateCents}`,
    );

    // The fix: getExpectedPaymentTotalCents computed from the QUEUE's
    // own data must equal the same combined total the detail screen and
    // approveBookingPaymentProof already agree on — no more disagreement
    // between the two screens for the same booking.
    const queueExpected = getExpectedPaymentTotalCents(found!.booking);
    assert(
      queueExpected === combinedCents,
      `expected the queue's own Expected computation to equal ${combinedCents} (court + coaching), got ${queueExpected}`,
    );
    console.log(
      `PASS: listPendingProofs includes coachSession, and the queue's own getExpectedPaymentTotalCents(${queueExpected}) now agrees with the detail screen's total (${combinedCents}) — no more Bea-Señeris-style disagreement.`,
    );

    await cleanUp(court.id, coach.id);
  } catch (error) {
    await cleanUp(court.id, coach.id);
    throw error;
  } finally {
    await settingsService.setBookingRequirePrepayment(true, owner.id);
  }

  console.log(
    "\nPASS: the verification queue and detail screen compute the exact same Expected total, proven against real rows.",
  );
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
