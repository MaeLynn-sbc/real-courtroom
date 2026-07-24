
-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_key_key" ON "Equipment"("key");

