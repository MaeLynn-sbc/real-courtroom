-- CreateEnum
CREATE TYPE "PlayerTabStatus" AS ENUM ('OPEN', 'SETTLED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "TabLineItemType" AS ENUM ('GAME', 'RENTAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TabSettlementMethod" AS ENUM ('CASH', 'GCASH');

-- AlterEnum
ALTER TYPE "SaleCategory" ADD VALUE 'OPEN_PLAY';

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "playerTabId" TEXT;

-- CreateTable
CREATE TABLE "PlayerTab" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT,
    "registrationId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "gameRateCents" INTEGER NOT NULL,
    "status" "PlayerTabStatus" NOT NULL DEFAULT 'OPEN',
    "settledAt" TIMESTAMP(3),
    "settledByUserId" TEXT,
    "settledVia" "TabSettlementMethod",
    "gcashReference" TEXT,
    "writeOffReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerTab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TabLineItem" (
    "id" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "type" "TabLineItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "qtyOrGames" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "gameAssignmentId" TEXT,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TabLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerTab_registrationId_key" ON "PlayerTab"("registrationId");

-- CreateIndex
CREATE INDEX "PlayerTab_date_status_idx" ON "PlayerTab"("date", "status");

-- CreateIndex
CREATE INDEX "PlayerTab_sessionId_idx" ON "PlayerTab"("sessionId");

-- CreateIndex
CREATE INDEX "TabLineItem_tabId_idx" ON "TabLineItem"("tabId");

-- CreateIndex
CREATE UNIQUE INDEX "TabLineItem_tabId_gameAssignmentId_key" ON "TabLineItem"("tabId", "gameAssignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_playerTabId_key" ON "Sale"("playerTabId");

-- AddForeignKey
ALTER TABLE "PlayerTab" ADD CONSTRAINT "PlayerTab_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "OpenPlayNightRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerTab" ADD CONSTRAINT "PlayerTab_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OpenPlayNightSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabLineItem" ADD CONSTRAINT "TabLineItem_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "PlayerTab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabLineItem" ADD CONSTRAINT "TabLineItem_gameAssignmentId_fkey" FOREIGN KEY ("gameAssignmentId") REFERENCES "GameAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_playerTabId_fkey" FOREIGN KEY ("playerTabId") REFERENCES "PlayerTab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

