-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "gcashReference" TEXT,
ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "settledByUserId" TEXT,
ADD COLUMN     "settledVia" "TabSettlementMethod";

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_settledByUserId_fkey" FOREIGN KEY ("settledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
