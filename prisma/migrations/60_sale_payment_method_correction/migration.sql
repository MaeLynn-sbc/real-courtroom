-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "paymentMethodCorrectedAt" TIMESTAMP(3),
ADD COLUMN     "paymentMethodCorrectedByEmployeeId" TEXT,
ADD COLUMN     "paymentMethodCorrectionReason" TEXT;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_paymentMethodCorrectedByEmployeeId_fkey" FOREIGN KEY ("paymentMethodCorrectedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
