-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "businessDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Sale_businessDate_idx" ON "Sale"("businessDate");
