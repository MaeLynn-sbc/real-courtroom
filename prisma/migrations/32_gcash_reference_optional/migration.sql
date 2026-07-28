-- The customer-facing GCash proof upload treats the reference number
-- as optional as long as a screenshot is attached — the screenshot is
-- the actual proof of payment; the reference is a convenience for
-- staff, not a hard requirement. No change needed to the hand-written
-- partial unique index (BookingPaymentProof_gcashReference_active_key,
-- migration 18): Postgres never treats two NULLs as equal for
-- uniqueness purposes, so multiple NULL-reference PENDING/APPROVED
-- rows already coexist safely under that same index.
ALTER TABLE "BookingPaymentProof" ALTER COLUMN "gcashReference" DROP NOT NULL;
