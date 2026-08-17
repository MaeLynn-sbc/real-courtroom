-- TournamentCategory.hasThirdPlaceMatch — opt-in third-place ("bronze")
-- playoff between the two semifinal losers.
--
-- Purely additive with a safe default: every existing category keeps its
-- current behaviour (no bronze match) until someone turns it on. No
-- backfill needed, unlike migration 74.
ALTER TABLE "TournamentCategory"
ADD COLUMN "hasThirdPlaceMatch" BOOLEAN NOT NULL DEFAULT false;
