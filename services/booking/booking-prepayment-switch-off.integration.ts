/**
 * The proof that protects the real Fridays: with the prepayment switch
 * explicitly OFF (no longer the default — see getBookingRequirePrepayment's
 * own comment), the public booking path is byte-for-byte unchanged from
 * before Phase 8. Calls createPublicBooking
 * (services/booking/public-booking.service.ts) — the exact function
 * actions/public-booking.actions.ts calls, minus only the revalidatePath
 * calls that can't run outside a real request context.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { settingsService } from "../settings/settings.service";
import { createPublicBooking } from "./public-booking.service";

const TEST_DATE = new Date(2031, 5, 12); // Thursday, far enough out not to collide with real usage

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
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
  const ids = bookings.map((b) => b.id);
  await prisma.sale.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

async function main(): Promise<void> {
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  await cleanUp(court.id);

  try {
    // The switch now defaults to true (owner's deploy decision — see
    // getBookingRequirePrepayment's own comment), so this "switch off"
    // scenario must actively turn it off rather than rely on an ambient
    // default that no longer exists. Restored back to true in this
    // function's own cleanup below, regardless of outcome — same
    // "always leave shared, persistent state in its real default"
    // discipline as booking-prepayment-switch-on.integration.ts's
    // finally block.
    await settingsService.setBookingRequirePrepayment(false, owner.id);
    const requiresPrepayment = await settingsService.getBookingRequirePrepayment();
    assert(requiresPrepayment === false, `expected the switch to read false, got ${requiresPrepayment}`);
    console.log("Switch turned OFF for this test.");

    const startAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 10, 0);
    const endAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), 11, 0);

    const result = await createPublicBooking({
      courtId: court.id,
      startAt,
      endAt,
      guestName: "Switch Off Guest",
      guestPhone: "09171110006",
    });

    console.log(`requiresPayment in the returned result: ${result.requiresPayment}`);
    assert(result.requiresPayment === false, `expected requiresPayment=false with the switch off, got ${result.requiresPayment}`);
    assert(result.holdExpiresAt === undefined, `expected no holdExpiresAt with the switch off, got ${result.holdExpiresAt}`);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: result.bookingId } });
    console.log(`Booking: status=${booking.status}, source=${booking.source}, holdExpiresAt=${booking.holdExpiresAt}`);
    assert(booking.status === "CONFIRMED", `expected status CONFIRMED (exactly as today), got ${booking.status}`);
    assert(booking.source === "PUBLIC", `expected source PUBLIC, got ${booking.source}`);
    assert(booking.holdExpiresAt === null, `expected holdExpiresAt null, got ${booking.holdExpiresAt}`);

    const sale = await prisma.sale.findUnique({ where: { bookingId: booking.id } });
    console.log(`Sale created at booking time: ${sale ? "yes" : "no"}`);
    assert(sale !== null, "expected a Sale to be created immediately, exactly as every pay-at-court booking today");
    assert(sale.status === "COMPLETED", `expected the Sale to be COMPLETED immediately, got ${sale.status}`);

    const proofs = await prisma.bookingPaymentProof.findMany({ where: { bookingId: booking.id } });
    assert(proofs.length === 0, `expected zero BookingPaymentProof rows with the switch off, got ${proofs.length}`);

    await cleanUp(court.id);
    console.log(
      "PASS: with the prepayment switch explicitly off, createPublicBooking behaves exactly as it did before Phase 8 — instant CONFIRMED booking, Sale created immediately, no hold, no proof row.",
    );
  } finally {
    // Always restore the real deploy default, regardless of outcome —
    // this is shared, persistent state (a Setting row), not test-local
    // data.
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
