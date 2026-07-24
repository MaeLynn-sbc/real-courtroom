-- Pre-Phase-8 booking visibility: an explicit source on Booking itself,
-- not inferred at read time from Sale.source (a separate, nullable-
-- linked row) or bookedById (points at a seeded system identity).
-- Purely additive (new type, new column with a NOT NULL default) — no
-- existing data is touched by this migration. Every existing row lands
-- on the default UNKNOWN until scripts/backfill-booking-source.ts runs
-- immediately after this migration, which resolves what it can and
-- reports how many rows landed in each bucket. New rows never rely on
-- the default — createBooking sets PUBLIC or STAFF explicitly.
-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('PUBLIC', 'STAFF', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "source" "BookingSource" NOT NULL DEFAULT 'UNKNOWN';

