-- Cash physically pulled from the drawer at close (bank deposit/safe).
-- Purely additive, backfilled to 0 for every existing row — matches the
-- prior (and still-correct-for-history) behavior where the full confirmed
-- ending balance carried forward as-is.

-- AlterTable
ALTER TABLE "CashDailyBalance" ADD COLUMN "withdrawnCents" INTEGER NOT NULL DEFAULT 0;
