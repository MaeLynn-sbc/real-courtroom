-- DropIndex
DROP INDEX "TabLineItem_tabId_gameAssignmentId_key";

-- AlterTable
ALTER TABLE "PlayerTab" ADD COLUMN     "writeOffEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "TabLineItem" ADD COLUMN     "voidsLineItemId" TEXT;

-- CreateIndex
CREATE INDEX "TabLineItem_tabId_gameAssignmentId_idx" ON "TabLineItem"("tabId", "gameAssignmentId");

-- CreateIndex
CREATE INDEX "TabLineItem_voidsLineItemId_idx" ON "TabLineItem"("voidsLineItemId");

-- AddForeignKey
ALTER TABLE "PlayerTab" ADD CONSTRAINT "PlayerTab_writeOffEmployeeId_fkey" FOREIGN KEY ("writeOffEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabLineItem" ADD CONSTRAINT "TabLineItem_voidsLineItemId_fkey" FOREIGN KEY ("voidsLineItemId") REFERENCES "TabLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

