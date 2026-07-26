-- Gate 3 gap fix (found while building the verification screen, see
-- prisma/schema.prisma's comment on BookingPaymentProof.submittedAmountCents):
-- §8's "flag when the submitted amount doesn't match what's owed"
-- requires a stored number to compare against Booking.totalAmountCents.
-- Zero BookingPaymentProof rows exist in any real environment yet (the
-- prepayment switch has never been on outside integration tests, which
-- clean up after themselves) — safe to add NOT NULL with no default,
-- nothing to backfill.
-- AlterTable
ALTER TABLE "BookingPaymentProof" ADD COLUMN "submittedAmountCents" INTEGER NOT NULL;
