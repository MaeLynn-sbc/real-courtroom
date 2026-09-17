-- Per-game length and price (owner, 2026-09-18: "a 15 min / ₱30 per game
-- option, toggled with the 20 min / ₱35 one"). Each game snapshots the
-- format that applied when it was put on a court, so flipping the switch
-- mid-night never changes a running timer or what a game already cost.
--
-- Nullable: games created before this column read the open play
-- settings exactly as before. PURELY ADDITIVE: no row changes.
ALTER TABLE "GameAssignment" ADD COLUMN "gameMinutes" INTEGER;
ALTER TABLE "GameAssignment" ADD COLUMN "gameRateCents" INTEGER;
