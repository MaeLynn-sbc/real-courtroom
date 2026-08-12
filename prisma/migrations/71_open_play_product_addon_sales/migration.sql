-- AlterTable
ALTER TABLE "TabLineItem" ADD COLUMN     "productId" TEXT;

-- Sale.playerTabId was @unique, modeled the same way productId was
-- before migration 29 — one Sale per one-time transaction row. A
-- settled PlayerTab now creates up to two kinds of Sale (one combined
-- OPEN_PLAY sale for game/rental/adjustment charges, plus one PRODUCT
-- sale per distinct add-on line item, mirroring how BookingTab already
-- settles), so a single tab can have more than one Sale row.
DROP INDEX "Sale_playerTabId_key";

-- AlterTable
CREATE INDEX "Sale_playerTabId_idx" ON "Sale"("playerTabId");
