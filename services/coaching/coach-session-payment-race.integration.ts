/**
 * createCoachSession's PAYMENT_ALREADY_SUBMITTED guard (public-coach
 * add-on payment fix) reads BookingPaymentProof inside a Serializable
 * transaction — but bookingPaymentProofService.submitBookingPaymentProof
 * runs at Postgres's default isolation level, not Serializable. Proven
 * directly against raw Postgres before building the fix: a plain SELECT,
 * even under Serializable isolation, does NOT block a concurrent UPDATE
 * on the same row (confirmed with two raw `pg` connections — the
 * "victim" UPDATE completed in 5ms while the Serializable side was still
 * mid-transaction, then the Serializable side correctly got a 40001
 * "could not serialize access" on its own later write instead of ever
 * being blocked). That means, pre-fix, a coach-add and a concurrent
 * proof submission can interleave: the coach-add reads "no proof yet," a
 * proof commits while it's mid-transaction, and the coach-add still
 * inserts using its now-stale read — reproduced live via a temporary
 * artificial delay added to createCoachSession between its proof-check
 * and its write (removed once confirmed; not present in the permanent
 * code, and not needed here — see the fix's own comment in
 * coach-session.service.ts for the full account).
 *
 * The fix is an explicit `SELECT ... FOR UPDATE` on the Booking row,
 * taken as the first thing inside createCoachSession's transaction.
 * Proving that live without re-introducing a source-level delay (which
 * would make this a flaky permanent test) means proving the two halves
 * of the mechanism directly and deterministically, each using an
 * EXTERNALLY held row lock (a raw `pg` connection under our own control,
 * not the application code) instead of guessing at application timing:
 *
 *   A) While the Booking row is externally locked, does
 *      submitBookingPaymentProof's own write genuinely block on it?
 *   B) While the Booking row is externally locked, does
 *      createCoachSession itself genuinely block trying to acquire it —
 *      proving its SELECT ... FOR UPDATE really executes and really
 *      takes the lock, not a no-op?
 *
 * Both true, together, is the mutual-exclusion guarantee that closes the
 * race — proven without any timing dependency on how fast either
 * function's own internal work happens to run.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { Client } from "pg";

import { prisma } from "../../lib/prisma";
import { bookingPaymentProofService } from "../booking/booking-payment-proof.service";
import { createPublicBooking } from "../booking/public-booking.service";
import { getWebsiteBookingContext } from "../booking/website-identity";
import { settingsService } from "../settings/settings.service";
import { addPublicCoachToBooking } from "./public-coach-session";
import { coachAvailabilityService } from "./coach-availability.service";
import { coachRateService } from "./coach-rate.service";

const TEST_DATE = new Date(2031, 6, 17); // Thursday, distinct from other coaching fixtures' dates
const TEST_USERNAME_PREFIX = "it-coachpayrace-";
const HOLD_MS = 400;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Opens its own raw connection, locks the given Booking row, holds it
// for holdMs, then releases it — a controllable stand-in for whichever
// of createCoachSession/submitBookingPaymentProof might be mid-
// transaction in production, without depending on either one's actual
// execution speed.
async function holdExternalRowLock(bookingId: string, holdMs: number): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM "Booking" WHERE id = $1 FOR UPDATE`, [bookingId]);
    await sleep(holdMs);
    await client.query("COMMIT");
  } finally {
    await client.end();
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
  const role = await prisma.role.findFirstOrThrow({ where: { name: "RECEPTIONIST" } });
  const coachUser = await prisma.user.create({
    data: { name: `${TEST_USERNAME_PREFIX}${ts}`, username: `${TEST_USERNAME_PREFIX}${ts}`, roleId: role.id },
  });
  const coach = await prisma.employee.create({
    data: { userId: coachUser.id, employeeNumber: `${TEST_USERNAME_PREFIX}${ts}-num`, firstName: "Race", lastName: "Coach", isCoach: true },
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
  const websiteContext = await getWebsiteBookingContext();

  try {
    await settingsService.setBookingRequirePrepayment(true, owner.id);

    // ============== Part A: submitBookingPaymentProof blocks on an externally-held lock ==============
    const slotA = slot(9);
    const holdA = await createPublicBooking({
      courtId: court.id,
      startAt: slotA.startAt,
      endAt: slotA.endAt,
      guestName: "Race Guest A",
      guestPhone: "09171110031",
    });

    const lockA = holdExternalRowLock(holdA.bookingId, HOLD_MS);
    await sleep(50); // let the external lock actually be acquired first
    const t0a = Date.now();
    await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: holdA.bookingId,
      gcashReference: `COACHPAYRACE-A-${ts}`,
      submittedAmountCents: holdA.totalAmountCents,
      screenshot: screenshot(),
    });
    const proofBlockedMs = Date.now() - t0a;
    await lockA;
    console.log(`  Part A: submitBookingPaymentProof took ${proofBlockedMs}ms while the row was externally locked for ${HOLD_MS}ms.`);
    assert(
      proofBlockedMs >= HOLD_MS - 100,
      `expected submitBookingPaymentProof's write to block on the externally-held row lock (>= ~${HOLD_MS - 100}ms), took only ${proofBlockedMs}ms — Postgres row locking isn't behaving as this fix depends on.`,
    );
    console.log("PASS: submitBookingPaymentProof's write genuinely blocks on a held Booking row lock.");

    // ============== Part B: createCoachSession itself blocks trying to acquire the same lock ==============
    const slotB = slot(11);
    const holdB = await createPublicBooking({
      courtId: court.id,
      startAt: slotB.startAt,
      endAt: slotB.endAt,
      guestName: "Race Guest B",
      guestPhone: "09171110032",
    });

    const lockB = holdExternalRowLock(holdB.bookingId, HOLD_MS);
    await sleep(50);
    const t0b = Date.now();
    const addResult = await addPublicCoachToBooking({ bookingId: holdB.bookingId, coachId: coach.id, groupSize: 1 }, websiteContext.userId);
    const addBlockedMs = Date.now() - t0b;
    await lockB;
    console.log(`  Part B: createCoachSession took ${addBlockedMs}ms while the row was externally locked for ${HOLD_MS}ms (error=${addResult.error}).`);
    assert(addResult.error === null, `expected the coach add-on to succeed once the external lock released, got: ${addResult.error}`);
    assert(
      addBlockedMs >= HOLD_MS - 100,
      `expected createCoachSession's own SELECT ... FOR UPDATE to block on the externally-held row lock (>= ~${HOLD_MS - 100}ms), took only ${addBlockedMs}ms — the fix's row lock isn't actually being taken.`,
    );
    console.log("PASS: createCoachSession's own row lock genuinely blocks on (and correctly waits out) a concurrently held lock on the same row.");

    await cleanUp(court.id);
    console.log("\nPASS: both halves of the mutual-exclusion guarantee hold — the coach-add vs. concurrent payment-proof race is closed.");
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
