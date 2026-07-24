/**
 * One-time backfill for Booking.source (prisma/migrations/16_booking_source),
 * run once after that migration lands. Every row starts at the migration's
 * default, UNKNOWN — this resolves what it safely can from two proxies that
 * existed before the field did: the linked Sale's source, and whether
 * bookedBy is the seeded Website system identity. Resolution logic itself
 * lives in services/booking/booking-source.ts (resolveBookingSource, Jest-
 * tested there) — kept out of this file specifically so it stays free of
 * lib/prisma, which this script needs and that pure-logic file must not.
 *
 * Idempotent by construction: scoped to `WHERE source = 'UNKNOWN'`, so
 * re-running only ever touches rows still at the default — a booking
 * already resolved to PUBLIC/STAFF (by this script or by createBooking
 * setting it explicitly at creation, going forward) is never revisited.
 *
 * Run via `npx tsx scripts/backfill-booking-source.ts`. Requires the dev
 * database up. Prints a report of how many rows landed in each bucket —
 * that report is the point of running it, not just a side effect.
 */
import "dotenv/config";

import { prisma } from "../lib/prisma";
import type { BookingSource } from "../lib/generated/prisma/enums";
import { WEBSITE_SYSTEM_USER_EMAIL } from "../lib/system-identities";
import { resolveBookingSource } from "../services/booking/booking-source";

async function main(): Promise<void> {
  const bookings = await prisma.booking.findMany({
    where: { source: "UNKNOWN" },
    select: {
      id: true,
      sale: { select: { source: true } },
      bookedBy: { select: { email: true } },
    },
  });

  const counts: Record<BookingSource, number> = { PUBLIC: 0, STAFF: 0, UNKNOWN: 0 };

  for (const booking of bookings) {
    const resolved = resolveBookingSource(
      booking.sale?.source ?? null,
      booking.bookedBy.email === WEBSITE_SYSTEM_USER_EMAIL,
    );
    counts[resolved] += 1;
    if (resolved !== "UNKNOWN") {
      await prisma.booking.update({ where: { id: booking.id }, data: { source: resolved } });
    }
  }

  console.log(
    `Backfilled ${bookings.length} row(s) that were UNKNOWN:\n` +
      `  PUBLIC:  ${counts.PUBLIC}\n` +
      `  STAFF:   ${counts.STAFF}\n` +
      `  UNKNOWN: ${counts.UNKNOWN} (left as-is — no write needed, already the default)`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
