-- Shift GCash check (owner request, 2026-09-26): staff record the GCash
-- app balance at shift start and end, so a GCash payment rung up as Cash
-- shows at the shift itself instead of only at daily reconciliation.
--
-- Additive and nullable, like migrations 82, 86 and 87: every existing
-- shift keeps NULL here and simply skips the GCash check, and a rollback
-- to the previous build ignores these columns entirely.
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "openingGcashCents" INTEGER;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "closingGcashCents" INTEGER;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "gcashVarianceCents" INTEGER;
