-- Step 3 of the pre-deploy staff-accounts round: temp-password-at-creation
-- + forced first-login change. mustChangePassword defaults false so
-- existing rows (the bootstrapped Owner, any already-created staff) are
-- unaffected — nobody gets locked out of an account that already has a
-- password they know. passwordChangedAt starts NULL for existing rows;
-- auth.ts's jwt() callback treats NULL the same as "never changed," which
-- is accurate for every pre-existing row.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3);
