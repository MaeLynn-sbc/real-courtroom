/**
 * Owner-flagged gap: Booking.totalAmountCents is court hire only —
 * coaching is attached afterward as a separate CoachSession with its
 * own rateCents, and nothing ever rolled the two together. Staff
 * verification (payment-verification-detail.tsx) read
 * proof.booking.totalAmountCents directly as "expected," so a customer
 * who correctly paid court + coaching combined showed as an amount
 * MISMATCH every time. This proves the fix: getExpectedPaymentTotalCents
 * (lib/booking-payment-total.ts) — now what both the verification
 * screen and the customer-facing total are computed from — correctly
 * includes the coach session's fee, while the raw
 * booking.totalAmountCents alone (the old "expected" value) still
 * understates it, demonstrating the bug it replaces.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { getExpectedPaymentTotalCents } from "../../lib/booking-payment-total";
import { prisma } from "../../lib/prisma";
import { bookingPaymentProofService } from "../booking/booking-payment-proof.service";
import { createPublicBooking } from "../booking/public-booking.service";
import { getWebsiteBookingContext } from "../booking/website-identity";
import { settingsService } from "../settings/settings.service";
import { addPublicCoachToBooking } from "./public-coach-session";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachRateService } from "./coach-rate.service";

const TEST_DATE = new Date(2031, 6, 18); // Friday, distinct from other integration fixtures' dates
const TEST_USERNAME_PREFIX = "it-expectedtotal-";
const COACH_RATE_CENTS = 40000; // ₱400

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
    data: { name: "Expected Total Coach", username: coachUsername, roleId: role.id },
  });
  const coach = await prisma.employee.create({
    data: {
      userId: coachUser.id,
      employeeNumber: `EXPTOTALCOACH-${Date.now()}`,
      firstName: "Expected",
      lastName: "Total",
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
      guestName: "Expected Total Guest",
      guestPhone: "09171110099",
    });
    assert(hold.requiresPayment === true, "expected the hold to require payment");
    const courtCents = hold.totalAmountCents ?? 0;
    console.log(`Court hire only: ${courtCents} cents`);

    const websiteContext = await getWebsiteBookingContext();
    const addCoachResult = await addPublicCoachToBooking(
      { bookingId: hold.bookingId, coachId: coach.id, groupSize: 1 },
      websiteContext.userId,
    );
    assert(addCoachResult.error === null, `expected the coach add-on to succeed, got: ${addCoachResult.error}`);

    const combinedCents = courtCents + COACH_RATE_CENTS;
    console.log(`Combined (court + coaching) actually owed: ${combinedCents} cents`);

    const proof = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: hold.bookingId,
      gcashReference: `EXPTOTAL-${Date.now()}`,
      submittedAmountCents: combinedCents,
      screenshot: screenshot(),
    });

    const fetchedProof = await bookingPaymentProofService.getProofById(proof.id);
    if (!fetchedProof) {
      throw new Error("expected the submitted proof to be fetchable");
    }

    // The bug: reading booking.totalAmountCents alone (the old
    // "expected" value) understates what's actually owed.
    const oldExpected = fetchedProof.booking.totalAmountCents ?? 0;
    console.log(`OLD "expected" (court only): ${oldExpected} cents — customer correctly paid ${combinedCents}`);
    assert(
      oldExpected < combinedCents,
      "expected the old court-only figure to UNDERSTATE the real total — demonstrating the bug this fix replaces",
    );

    // The fix: getExpectedPaymentTotalCents includes the coach session.
    const newExpected = getExpectedPaymentTotalCents(fetchedProof.booking);
    console.log(`NEW expected (court + coaching): ${newExpected} cents`);
    assert(newExpected === combinedCents, `expected getExpectedPaymentTotalCents to equal ${combinedCents}, got ${newExpected}`);
    assert(
      newExpected === fetchedProof.submittedAmountCents,
      "expected the new total to match what the customer actually (correctly) submitted — no false mismatch",
    );

    await cleanUp(court.id, coach.id);
    console.log(
      "PASS: getExpectedPaymentTotalCents correctly includes the coach session's fee — a customer paying court + coaching combined no longer shows as a false amount mismatch.",
    );
  } finally {
    await settingsService.setBookingRequirePrepayment(true, owner.id);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
