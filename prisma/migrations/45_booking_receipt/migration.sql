-- Optional receipt/proof-of-payment attachment, captured at settle time
-- for pay-at-venue bookings. Purely additive.

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "receiptStorageKey" TEXT;
