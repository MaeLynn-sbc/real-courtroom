-- Regular play on a Fri/Sat (owner request, 2026-10-31): "change the unli
-- play for later to regular play, the 35 per game". A per-date switch
-- that runs the night as weeknight open play (per-game tabs, no ₱150
-- registration), with its own per-court open-play hours so the rest of
-- the evening can go to bookings.
--
-- Additive with safe defaults: every existing night stays Unliplay, and a
-- rollback to the previous build ignores these columns entirely.
ALTER TABLE "OpenPlayNightSession" ADD COLUMN IF NOT EXISTS "regularPlay" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OpenPlayNightSession" ADD COLUMN IF NOT EXISTS "regularPlayHours" JSONB;
