import type { BookingSource, SaleSource } from "@/lib/generated/prisma/enums";

// Pure resolution logic — kept import-light (type-only imports of the
// generated enums) so it stays Jest-testable, same reasoning as
// booking-status.ts/booking-reference.ts: this file must never import
// lib/prisma (or anything that transitively does), because that
// constructs a real Postgres adapter at module-load time and Jest's
// jsdom environment can't load it (confirmed live: `ReferenceError:
// TextEncoder is not defined` the first time this was tried with prisma
// imported alongside it).
//
// Used by scripts/backfill-booking-source.ts to resolve Booking.source
// for historical rows from two proxies that existed before the field
// did: the linked Sale's source, and whether bookedBy is the seeded
// Website system identity. Resolves ONLY when both signals agree — see
// that script's own comment for why disagreement or an unresolvable
// signal means UNKNOWN, not a guess.
export function resolveBookingSource(
  saleSource: SaleSource | null,
  bookedByIsWebsiteIdentity: boolean,
): BookingSource {
  // MOBILE_APP/ADMIN/TOURNAMENT are real SaleSource values but are never
  // actually set for a Booking's Sale by any code path today (only
  // createBooking creates a Booking's Sale, and it only ever passes
  // "WEBSITE" or leaves it to default to "RECEPTION") — if one shows up
  // here, it's unexpected for this table, treated as unresolved rather
  // than guessed into either bucket.
  const fromSale: BookingSource | null =
    saleSource === "WEBSITE" ? "PUBLIC" : saleSource === "RECEPTION" ? "STAFF" : null;
  const fromBookedBy: BookingSource = bookedByIsWebsiteIdentity ? "PUBLIC" : "STAFF";

  if (fromSale !== null && fromSale === fromBookedBy) {
    return fromSale;
  }
  return "UNKNOWN";
}
