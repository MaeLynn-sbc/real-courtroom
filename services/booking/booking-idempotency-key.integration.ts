/**
 * Real incident (2026-08-06): the public booking form's only double-submit
 * protection was a React disabled-state that isn't atomic with the click —
 * a fast double-tap could fire createBookingHold twice for the same slot.
 * One succeeded; the other legitimately conflicted with the customer's OWN
 * just-created hold ("This court is already booked" / "That slot was just
 * taken"), and whichever response rendered last decided what the customer
 * saw — so a successful booking could look, to the customer, like it had
 * failed.
 *
 * Proves, against real rows:
 *   1. Two concurrent createBookingHold calls, SAME idempotencyKey, SAME
 *      slot -> exactly ONE Booking row, and BOTH calls resolve
 *      successfully, both returning that same booking. Proven
 *      failing-first — run against the pre-fix code, this produced one
 *      success and one thrown BookingConflictError.
 *   2. Two concurrent createBookingHold calls, DIFFERENT idempotencyKeys
 *      (genuinely different customers), SAME slot -> exactly one succeeds,
 *      the other gets a real BookingConflictError. Must keep working —
 *      this is the actual double-booking protection, untouched by the fix.
 *   3. Calling createBookingHold twice SEQUENTIALLY with the same key
 *      (no race at all — e.g. a client retry after a dropped response)
 *      returns the same booking both times, no duplicate row.
 *   4. The same key reused against a DIFFERENT slot is rejected outright,
 *      not silently returned as if it matched — a stale/reused key must
 *      never hand back the wrong booking.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { BookingConflictError, bookingService } from "./booking.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

// Saturday, far enough out not to collide with real usage or other
// fixtures this session (distinct from booking-hold-expiry-cap's own
// 2031-06-14 and every payroll fixture's 2031 dates).
const TEST_DATE = new Date(2031, 7, 30);

function at(hour: number): Date {
  return new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hour, 0);
}

async function cleanUp(courtId: string): Promise<void> {
  const dayEnd = new Date(TEST_DATE);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const bookings = await prisma.booking.findMany({
    where: { courtId, startAt: { gte: TEST_DATE, lt: dayEnd } },
    select: { id: true },
  });
  const ids = bookings.map((b) => b.id);
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

interface Settled<T> {
  status: "fulfilled" | "rejected";
  value?: T;
  error?: unknown;
}

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    const value = await promise;
    return { status: "fulfilled", value };
  } catch (error) {
    return { status: "rejected", error };
  }
}

async function main(): Promise<void> {
  const websiteUser = await prisma.user.findFirstOrThrow({ where: { email: "website@thecourtroom.local" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });

  await cleanUp(court.id);

  try {
    // ============== 1. Same idempotency key, concurrent -> one row, both succeed ==============
    const slot1Start = at(7);
    const slot1End = at(8);
    const sharedKey = `test-idem-${Date.now()}-shared`;

    const [resultA, resultB] = await Promise.all([
      settle(
        bookingService.createBookingHold(
          { courtId: court.id, type: "HOURLY", startAt: slot1Start, endAt: slot1End, guestName: "Racer A", guestPhone: "09171110020", idempotencyKey: sharedKey },
          websiteUser.id,
        ),
      ),
      settle(
        bookingService.createBookingHold(
          { courtId: court.id, type: "HOURLY", startAt: slot1Start, endAt: slot1End, guestName: "Racer A", guestPhone: "09171110020", idempotencyKey: sharedKey },
          websiteUser.id,
        ),
      ),
    ]);

    assert(
      resultA.status === "fulfilled" && resultB.status === "fulfilled",
      `expected BOTH concurrent calls with the same idempotency key to succeed — got A=${resultA.status}${resultA.status === "rejected" ? ` (${(resultA.error as Error)?.message})` : ""}, B=${resultB.status}${resultB.status === "rejected" ? ` (${(resultB.error as Error)?.message})` : ""}`,
    );
    assert(
      resultA.value!.id === resultB.value!.id && resultA.value!.bookingReference === resultB.value!.bookingReference,
      "expected both calls to return the SAME booking (same id, same reference)",
    );
    const rowCount1 = await prisma.booking.count({
      where: { courtId: court.id, startAt: slot1Start, endAt: slot1End },
    });
    assert(rowCount1 === 1, `expected exactly 1 Booking row for the shared-key race, got ${rowCount1}`);
    console.log(
      "PASS: two concurrent createBookingHold calls with the SAME idempotency key produce exactly one row, and both calls return success for it.",
    );

    // ============== 2. Different keys, concurrent -> one wins, one real conflict ==============
    const slot2Start = at(9);
    const slot2End = at(10);

    const [resultC, resultD] = await Promise.all([
      settle(
        bookingService.createBookingHold(
          { courtId: court.id, type: "HOURLY", startAt: slot2Start, endAt: slot2End, guestName: "Customer C", guestPhone: "09171110021", idempotencyKey: `test-idem-${Date.now()}-c` },
          websiteUser.id,
        ),
      ),
      settle(
        bookingService.createBookingHold(
          { courtId: court.id, type: "HOURLY", startAt: slot2Start, endAt: slot2End, guestName: "Customer D", guestPhone: "09171110022", idempotencyKey: `test-idem-${Date.now()}-d` },
          websiteUser.id,
        ),
      ),
    ]);

    const succeeded = [resultC, resultD].filter((r) => r.status === "fulfilled");
    const failed = [resultC, resultD].filter((r) => r.status === "rejected");
    assert(succeeded.length === 1, `expected exactly one of two different-customer concurrent attempts to succeed, got ${succeeded.length}`);
    assert(failed.length === 1, `expected exactly one to fail, got ${failed.length}`);
    assert(
      failed[0]!.error instanceof BookingConflictError,
      `expected the loser to get a real BookingConflictError, got ${(failed[0]!.error as Error)?.constructor?.name}`,
    );
    const rowCount2 = await prisma.booking.count({
      where: { courtId: court.id, startAt: slot2Start, endAt: slot2End },
    });
    assert(rowCount2 === 1, `expected exactly 1 Booking row for the different-customer race, got ${rowCount2}`);
    console.log(
      "PASS: two concurrent createBookingHold calls with DIFFERENT idempotency keys still produce exactly one winner and one real conflict — genuine double-booking protection is untouched.",
    );

    // ============== 3. Sequential retry with the same key -> idempotent, no duplicate ==============
    const slot3Start = at(11);
    const slot3End = at(12);
    const retryKey = `test-idem-${Date.now()}-retry`;

    const first = await bookingService.createBookingHold(
      { courtId: court.id, type: "HOURLY", startAt: slot3Start, endAt: slot3End, guestName: "Retry Guest", guestPhone: "09171110023", idempotencyKey: retryKey },
      websiteUser.id,
    );
    const second = await bookingService.createBookingHold(
      { courtId: court.id, type: "HOURLY", startAt: slot3Start, endAt: slot3End, guestName: "Retry Guest", guestPhone: "09171110023", idempotencyKey: retryKey },
      websiteUser.id,
    );
    assert(first.id === second.id, "expected a sequential retry with the same key to return the SAME booking, not create a new one");
    const rowCount3 = await prisma.booking.count({ where: { courtId: court.id, startAt: slot3Start, endAt: slot3End } });
    assert(rowCount3 === 1, `expected exactly 1 row after a sequential same-key retry, got ${rowCount3}`);
    console.log("PASS: a sequential retry with the same idempotency key (e.g. a dropped-response retry) returns the existing booking, not a duplicate.");

    // ============== 4. Same key, DIFFERENT slot -> rejected, never silently wrong ==============
    const slot4Start = at(13);
    const slot4End = at(14);
    let rejectedStaleKey = false;
    try {
      await bookingService.createBookingHold(
        { courtId: court.id, type: "HOURLY", startAt: slot4Start, endAt: slot4End, guestName: "Retry Guest", guestPhone: "09171110023", idempotencyKey: retryKey },
        websiteUser.id,
      );
    } catch {
      rejectedStaleKey = true;
    }
    assert(rejectedStaleKey, "expected reusing a key against a DIFFERENT slot to be rejected, not silently return the wrong booking");
    const rowCount4 = await prisma.booking.count({ where: { courtId: court.id, startAt: slot4Start, endAt: slot4End } });
    assert(rowCount4 === 0, "expected no row created for the rejected stale-key attempt");
    console.log("PASS: reusing an idempotency key against a different slot is rejected outright, never silently returns the wrong booking.");

    await cleanUp(court.id);
    console.log("\nPASS: booking idempotency key proven against real rows.");
  } catch (error) {
    await cleanUp(court.id);
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
