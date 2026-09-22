-- Voiding an expense (owner-reported incident, 2026-09-21): a PHP 8,200
-- coach payout was submitted twice, 15 seconds apart, on a slow
-- connection. The money left GCash once, so the duplicate row had to come
-- off the books — and nothing in this app hard-deletes a money row.
--
-- Additive and nullable, exactly like migration 82 and 86: every existing
-- expense keeps counting as it always has (voidedAt IS NULL), and a
-- rollback to the previous build ignores these columns entirely.
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "voidReason" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "voidedByEmployeeId" TEXT;

-- Matches the FK Prisma generates for the relation, and mirrors Sale's own
-- voidedByEmployeeId: SET NULL rather than CASCADE, so removing an
-- employee can never delete the record of money going out.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Expense_voidedByEmployeeId_fkey'
  ) THEN
    ALTER TABLE "Expense"
      ADD CONSTRAINT "Expense_voidedByEmployeeId_fkey"
      FOREIGN KEY ("voidedByEmployeeId") REFERENCES "Employee"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Every read of expense totals filters on voidedAt IS NULL.
CREATE INDEX IF NOT EXISTS "Expense_voidedAt_idx" ON "Expense"("voidedAt");
