-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "shortCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Booking_shortCode_key" ON "Booking"("shortCode");
