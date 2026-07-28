/**
 * The coach add-on payment-amount fix's ordering guard and its "remove"
 * companion. Two things proven here:
 *
 * 1. Reactivation. CoachSession.bookingId is @unique — one row per
 *    booking, ever. removeCoachSession only ever CANCELS that row (never
 *    deletes it), so createCoachSession's original existing-session guard
 *    ("if (existing) throw ALREADY_HAS_COACH_SESSION", checking existence
 *    only, not status) would permanently block ANY future coach for that
 *    booking the moment one was removed — even a different coach. Nothing
 *    in the codebase exercised remove-then-add before this feature: the
 *    only two existing callers of cancelCoachSession
 *    (booking-payment-proof.service.ts, booking.service.ts) are both
 *    booking-level cancellation cascades, not a standalone remove. Case 1
 *    proves add -> remove -> add-a-DIFFERENT-coach now works, reactivating
 *    the cancelled row rather than colliding with the unique constraint.
 *
 * 2. Ordering guard. Once a BookingPaymentProof row exists for a booking,
 *    add and remove are both rejected — the customer already committed to
 *    an amount; changing the coach after that would make it wrong with no
 *    way to reconcile it. A non-prepayment booking never gets a proof row
 *    at all, so it's untouched by this (not covered here — see
 *    coach-availability-day-set.integration.ts's case 6 and
 *    coach-session-phase8-interaction.integration.ts for the always-safe
 *    add path on a live, unresolved hold).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingPaymentProofService } from "../booking/booking-payment-proof.service";
import { createPublicBooking } from "../booking/public-booking.service";
import { getWebsiteBookingContext } from "../booking/website-identity";
import { settingsService } from "../settings/settings.service";
import { addPublicCoachToBooking, removePublicCoachFromBooking } from "./public-coach-session";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachRateService } from "./coach-rate.service";

const TEST_DATE = new Date(2031, 6, 15); // Tuesday, distinct from other coaching fixtures' dates
const TEST_USERNAME_PREFIX = "it-coachremove-";

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

async function makeCoach(username: string, hourlyWindow: [number, number]): Promise<{ id: string }> {
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const user = await prisma.user.create({ data: { name: username, username, roleId: role.id } });
  const coach = await prisma.employee.create({
    data: { userId: user.id, employeeNumber: `${username}-num`, firstName: "Test", lastName: "Coach", isCoach: true },
  });
  await coachAvailabilityService.createWindow(
    {
      coachId: coach.id,
      startAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hourlyWindow[0]),
      endAt: new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hourlyWindow[1]),
    },
    coach.id,
    owner.id,
  );
  await coachRateService.upsertRate({ coachId: coach.id, groupSize: 1, priceCents: 40000 }, owner.id);
  return coach;
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
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  await cleanUp(court.id);

  const ts = Date.now();
  const coachA = await makeCoach(`${TEST_USERNAME_PREFIX}a-${ts}`, [7, 20]);
  const coachB = await makeCoach(`${TEST_USERNAME_PREFIX}b-${ts}`, [7, 20]);
  const websiteContext = await getWebsiteBookingContext();

  try {
    await settingsService.setBookingRequirePrepayment(true, owner.id);

    // ============== Case 1: add -> remove -> add a DIFFERENT coach ==============
    const s1 = slot(9);
    const hold1 = await createPublicBooking({
      courtId: court.id,
      startAt: s1.startAt,
      endAt: s1.endAt,
      guestName: "Reactivation Guest",
      guestPhone: "09171110020",
    });

    const add1 = await addPublicCoachToBooking({ bookingId: hold1.bookingId, coachId: coachA.id, groupSize: 1 }, websiteContext.userId);
    assert(add1.error === null, `expected coach A to attach cleanly, got: ${add1.error}`);
    console.log("Coach A attached.");

    const remove1 = await removePublicCoachFromBooking({ bookingId: hold1.bookingId }, websiteContext.userId);
    assert(remove1.error === null, `expected removal to succeed, got: ${remove1.error}`);
    const afterRemove = await prisma.coachSession.findUniqueOrThrow({ where: { bookingId: hold1.bookingId } });
    assert(afterRemove.status === "CANCELLED", `expected the session to be CANCELLED after removal, got ${afterRemove.status}`);
    console.log("Coach A removed (session CANCELLED, row retained).");

    const add2 = await addPublicCoachToBooking({ bookingId: hold1.bookingId, coachId: coachB.id, groupSize: 1 }, websiteContext.userId);
    console.log(`Attaching a DIFFERENT coach (B) to the same booking: error=${add2.error}`);
    assert(add2.error === null, `expected coach B to attach after coach A was removed, got: ${add2.error}`);

    const allSessionsForBooking = await prisma.coachSession.findMany({ where: { bookingId: hold1.bookingId } });
    assert(allSessionsForBooking.length === 1, `expected exactly 1 CoachSession row (reactivated, not a second insert), found ${allSessionsForBooking.length}`);
    assert(allSessionsForBooking[0].coachId === coachB.id, `expected the reactivated row's coachId to now be coach B, got ${allSessionsForBooking[0].coachId}`);
    assert(allSessionsForBooking[0].status === "CONFIRMED", `expected the reactivated row to be CONFIRMED, got ${allSessionsForBooking[0].status}`);

    const history1 = await prisma.coachSessionHistory.findMany({ where: { coachSessionId: allSessionsForBooking[0].id }, orderBy: { createdAt: "asc" } });
    assert(history1.length === 3, `expected 3 history rows (attach A, cancel, attach B), found ${history1.length}`);
    console.log("PASS: add -> remove -> add-a-different-coach reactivates the same row instead of colliding with the bookingId unique constraint.");

    // ============== Case 2: ordering guard blocks ADD after proof ==============
    const s2 = slot(11);
    const hold2 = await createPublicBooking({
      courtId: court.id,
      startAt: s2.startAt,
      endAt: s2.endAt,
      guestName: "Ordering Guard Add Guest",
      guestPhone: "09171110021",
    });
    await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: hold2.bookingId,
      gcashReference: `COACHREMOVE-ADD-${ts}`,
      submittedAmountCents: hold2.totalAmountCents,
      screenshot: screenshot(),
    });

    const addAfterProof = await addPublicCoachToBooking({ bookingId: hold2.bookingId, coachId: coachA.id, groupSize: 1 }, websiteContext.userId);
    console.log(`Attempting to add a coach after proof was submitted: error=${addAfterProof.error}`);
    assert(addAfterProof.error !== null, "expected adding a coach after proof submission to be rejected, not silently allowed");
    assert(addAfterProof.error!.includes("already been submitted"), `expected the payment-already-submitted message, got: ${addAfterProof.error}`);
    const noSessionCreated = await prisma.coachSession.findUnique({ where: { bookingId: hold2.bookingId } });
    assert(noSessionCreated === null, "expected no CoachSession row to have been created for the rejected attempt");
    console.log("PASS: adding a coach after payment proof was submitted is rejected, not silently allowed.");

    // ============== Case 3: ordering guard blocks REMOVE after proof ==============
    const s3 = slot(13);
    const hold3 = await createPublicBooking({
      courtId: court.id,
      startAt: s3.startAt,
      endAt: s3.endAt,
      guestName: "Ordering Guard Remove Guest",
      guestPhone: "09171110022",
    });
    const add3 = await addPublicCoachToBooking({ bookingId: hold3.bookingId, coachId: coachA.id, groupSize: 1 }, websiteContext.userId);
    assert(add3.error === null, `expected coach A to attach before proof submission, got: ${add3.error}`);

    await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: hold3.bookingId,
      gcashReference: `COACHREMOVE-RM-${ts}`,
      submittedAmountCents: hold3.totalAmountCents + 40000,
      screenshot: screenshot(),
    });

    const removeAfterProof = await removePublicCoachFromBooking({ bookingId: hold3.bookingId }, websiteContext.userId);
    console.log(`Attempting to remove a coach after proof was submitted: error=${removeAfterProof.error}`);
    assert(removeAfterProof.error !== null, "expected removing a coach after proof submission to be rejected, not silently allowed");
    const stillConfirmed = await prisma.coachSession.findUniqueOrThrow({ where: { bookingId: hold3.bookingId } });
    assert(stillConfirmed.status === "CONFIRMED", `expected the coach session to remain CONFIRMED (removal blocked), got ${stillConfirmed.status}`);
    console.log("PASS: removing a coach after payment proof was submitted is rejected, not silently allowed.");

    await cleanUp(court.id);
    console.log("\nPASS: coach add-on reactivation + payment-ordering guard both proven against real rows.");
  } finally {
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
