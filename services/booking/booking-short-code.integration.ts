/**
 * Short booking code (2026-08-06, extended to staff bookings same day):
 * a 5-char, unambiguous code (services/booking/booking-short-code.ts) is
 * now generated for every new booking, regardless of source — the
 * prepayment-hold path (createBookingHold), the pay-at-venue immediate-
 * confirm path (createBooking with source WEBSITE), AND a plain staff-
 * created booking (createBooking with no source override). Every
 * staff-facing surface still shows bookingReference as the primary id;
 * the short code is what gets handed TO the customer, including for a
 * walk-in/phone booking staff create on their behalf.
 * bookingService.findByReferenceAndPhone (the public lookup page's
 * query) tries shortCode first, falling back to the full
 * bookingReference — proven both still work, case-insensitively. Also
 * proves the collision-retry path: generateShortCode is called INSIDE
 * the same Serializable-retry transaction as bookingReference/
 * qrCodeToken, so a real unique-constraint collision on Booking.shortCode
 * causes the whole transaction to retry with a fresh code, exactly like
 * createBooking already does for a genuine bookingReference/qrCodeToken
 * collision.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { generateShortCode } from "./booking-short-code";
import { bookingService, type CreateBookingSaleContext } from "./booking.service";
import { createPublicBooking } from "./public-booking.service";
import { settingsService } from "../settings/settings.service";

const TEST_DATE = new Date(2031, 5, 21); // Saturday, far enough out not to collide with real usage

const SHORT_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/;

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
  const ids = bookings.map((b) => b.id);
  await prisma.sale.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({ data: { shiftNumber: `SHIFT-SHORTCODE-${Date.now()}`, employeeId: employee.id, status: "OPEN" } });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });
  const baseSaleContext: CreateBookingSaleContext = { employeeId: employee.id, shiftId: shift.id, paymentMethodId: paymentMethod.id };

  await cleanUp(court.id);

  try {
    // --- Case 1: prepayment switch ON -> createBookingHold gets a short
    // code, matching the expected alphabet/length. ---
    await settingsService.setBookingRequirePrepayment(true, owner.id);
    const holdSlot = slot(9);
    const holdResult = await createPublicBooking({
      courtId: court.id,
      startAt: holdSlot.startAt,
      endAt: holdSlot.endAt,
      guestName: "Short Code Hold Guest",
      guestPhone: "09171110030",
    });
    console.log(`Case 1: hold created with shortCode=${holdResult.shortCode}`);
    assert(holdResult.shortCode !== null, "expected a short code on a prepayment hold");
    assert(SHORT_CODE_PATTERN.test(holdResult.shortCode!), `expected shortCode to match the 5-char safe alphabet, got ${holdResult.shortCode}`);
    console.log("PASS: a prepayment hold (createBookingHold) gets a valid short code.");

    // --- Case 2: prepayment switch OFF -> createBooking (WEBSITE source,
    // immediate CONFIRMED) also gets a short code. ---
    await settingsService.setBookingRequirePrepayment(false, owner.id);
    const confirmedSlot = slot(11);
    const confirmedResult = await createPublicBooking({
      courtId: court.id,
      startAt: confirmedSlot.startAt,
      endAt: confirmedSlot.endAt,
      guestName: "Short Code Confirmed Guest",
      guestPhone: "09171110031",
    });
    console.log(`Case 2: pay-at-venue booking created with shortCode=${confirmedResult.shortCode}`);
    assert(confirmedResult.shortCode !== null, "expected a short code on an immediately-confirmed public booking");
    assert(SHORT_CODE_PATTERN.test(confirmedResult.shortCode!), `expected shortCode to match the 5-char safe alphabet, got ${confirmedResult.shortCode}`);
    console.log("PASS: an immediately-confirmed public booking (createBooking, WEBSITE) also gets a valid short code.");

    // --- Case 3: a STAFF-created booking gets a short code too (owner
    // request, 2026-08-06, extended same day) — useful for a walk-in/
    // phone booking staff want to read back to the customer. ---
    const staffSlot = slot(13);
    const staffBooking = await bookingService.createBooking(
      { courtId: court.id, type: "HOURLY", startAt: staffSlot.startAt, endAt: staffSlot.endAt, guestName: "Short Code Staff Guest" },
      owner.id,
      baseSaleContext,
    );
    console.log(`Case 3: staff booking created with shortCode=${staffBooking.shortCode}`);
    assert(staffBooking.shortCode !== null, "expected a short code on a staff-created booking too");
    assert(SHORT_CODE_PATTERN.test(staffBooking.shortCode!), `expected shortCode to match the 5-char safe alphabet, got ${staffBooking.shortCode}`);
    console.log("PASS: a staff-created booking also gets a valid short code.");

    // --- Case 4: lookup tries shortCode first, falls back to
    // bookingReference — both work, case-insensitively. ---
    const byShortCodeLower = await bookingService.findByReferenceAndPhone(
      confirmedResult.shortCode!.toLowerCase(),
      "09171110031",
    );
    assert(byShortCodeLower !== null, "expected a lowercase short code to still find the booking");
    assert(byShortCodeLower!.id === confirmedResult.bookingId, "expected the lowercase short-code lookup to resolve to the same booking");
    console.log("PASS: lookup by short code (lowercase) finds the booking.");

    const byFullReference = await bookingService.findByReferenceAndPhone(
      confirmedResult.bookingReference,
      "09171110031",
    );
    assert(byFullReference !== null, "expected the full bookingReference to still work as a fallback");
    assert(byFullReference!.id === confirmedResult.bookingId, "expected the full-reference lookup to resolve to the same booking");
    console.log("PASS: lookup by the full booking reference still works (fallback unaffected).");

    const wrongPhone = await bookingService.findByReferenceAndPhone(confirmedResult.shortCode!, "09170000000");
    assert(wrongPhone === null, "expected a mismatched phone number to still be rejected (anti-enumeration check unaffected)");
    console.log("PASS: a mismatched phone number is still rejected (regression guard).");

    // --- Case 5: collision retry. A booking already holds a known short
    // code; Math.random is forced to reproduce that EXACT code on the
    // first generation attempt, then a different one on the next —
    // proving createBooking's existing runSerializableWithRetry actually
    // retries all the way to success on a genuine Booking.shortCode
    // collision, not just in theory. ---
    const collisionSlot = slot(15);
    const preExisting = await bookingService.createBooking(
      { courtId: court.id, type: "HOURLY", startAt: slot(16).startAt, endAt: slot(16).endAt, guestName: "Short Code Collision Holder" },
      owner.id,
      { ...baseSaleContext, source: "WEBSITE" },
    );
    // Captured EMPIRICALLY (call generateShortCode() for real under a
    // fixed Math.random) rather than hand-computed from the alphabet's
    // character positions — hand-computing that mapping is exactly the
    // kind of off-by-one mistake this test exists to not depend on.
    const originalRandom = Math.random;
    Math.random = () => 0.42;
    const collidingCode = generateShortCode();
    Math.random = originalRandom;
    await prisma.booking.update({ where: { id: preExisting.id }, data: { shortCode: collidingCode } });

    // Forces the exact colliding code on generateShortCode's first 5
    // calls (one attempt's worth) — the failing-first proof: this is
    // deliberately arranged to guarantee a real Postgres unique-
    // constraint violation on Booking.shortCode. Every call after that
    // uses REAL randomness again, both for runSerializableWithRetry's
    // own backoff jitter and for the retried attempt's fresh code —
    // virtually certain not to collide a second time (31^5 combinations).
    let callIndex = 0;
    Math.random = () => {
      callIndex += 1;
      return callIndex <= 5 ? 0.42 : originalRandom();
    };

    let collisionResult: Awaited<ReturnType<typeof bookingService.createBooking>>;
    try {
      collisionResult = await bookingService.createBooking(
        { courtId: court.id, type: "HOURLY", startAt: collisionSlot.startAt, endAt: collisionSlot.endAt, guestName: "Short Code Collision Guest" },
        owner.id,
        { ...baseSaleContext, source: "WEBSITE" },
      );
    } finally {
      Math.random = originalRandom;
    }
    console.log(`Case 5: forced a shortCode collision (${collidingCode}) — retry produced shortCode=${collisionResult.shortCode}`);
    assert(collisionResult.shortCode !== null, "expected the retried booking to still get a real short code");
    assert(SHORT_CODE_PATTERN.test(collisionResult.shortCode!), `expected the retried code to still match the safe alphabet, got ${collisionResult.shortCode}`);
    assert(collisionResult.shortCode !== collidingCode, "expected the retry to produce a DIFFERENT code than the one that collided");

    const stillHolding = await prisma.booking.findUniqueOrThrow({ where: { id: preExisting.id } });
    assert(stillHolding.shortCode === collidingCode, "expected the original booking's short code to be completely untouched by the collision/retry");
    console.log("PASS: a genuine Booking.shortCode collision is retried by the existing Serializable-retry machinery, producing a fresh, distinct code — proven against a real forced collision, not just asserted.");

    await cleanUp(court.id);
    console.log("\nPASS: short booking code feature proven against real rows.");
  } finally {
    // Restore the real deploy default (true) regardless of outcome —
    // same discipline as booking-prepayment-switch-on.integration.ts.
    await settingsService.setBookingRequirePrepayment(true, owner.id);
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
