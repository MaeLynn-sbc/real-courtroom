-- CreateEnum
CREATE TYPE "BookingTabLineItemType" AS ENUM ('PRODUCT', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "bookingTabId" TEXT;

-- CreateTable
CREATE TABLE "BookingTab" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "status" "PlayerTabStatus" NOT NULL DEFAULT 'OPEN',
    "settledAt" TIMESTAMP(3),
    "settledByUserId" TEXT,
    "settledVia" "TabSettlementMethod",
    "gcashReference" TEXT,
    "writeOffReason" TEXT,
    "writeOffEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingTab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingTabLineItem" (
    "id" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "type" "BookingTabLineItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "qtyOrGames" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "productId" TEXT,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidsLineItemId" TEXT,

    CONSTRAINT "BookingTabLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingTab_bookingId_key" ON "BookingTab"("bookingId");

-- CreateIndex
CREATE INDEX "BookingTab_status_idx" ON "BookingTab"("status");

-- CreateIndex
CREATE INDEX "BookingTabLineItem_tabId_idx" ON "BookingTabLineItem"("tabId");

-- CreateIndex
CREATE INDEX "BookingTabLineItem_productId_idx" ON "BookingTabLineItem"("productId");

-- CreateIndex
CREATE INDEX "Sale_bookingTabId_idx" ON "Sale"("bookingTabId");

-- AddForeignKey
ALTER TABLE "BookingTab" ADD CONSTRAINT "BookingTab_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingTab" ADD CONSTRAINT "BookingTab_writeOffEmployeeId_fkey" FOREIGN KEY ("writeOffEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingTabLineItem" ADD CONSTRAINT "BookingTabLineItem_voidsLineItemId_fkey" FOREIGN KEY ("voidsLineItemId") REFERENCES "BookingTabLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingTabLineItem" ADD CONSTRAINT "BookingTabLineItem_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "BookingTab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingTabLineItem" ADD CONSTRAINT "BookingTabLineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_bookingTabId_fkey" FOREIGN KEY ("bookingTabId") REFERENCES "BookingTab"("id") ON DELETE SET NULL ON UPDATE CASCADE;
