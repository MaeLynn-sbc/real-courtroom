-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedByEmployeeId" TEXT;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_voidedByEmployeeId_fkey" FOREIGN KEY ("voidedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
