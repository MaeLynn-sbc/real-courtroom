-- Sale.productId was mistakenly @unique, modeled by copy-paste from the
-- other Sale back-reference fields (bookingId, membershipId, etc.) —
-- those correctly point at one-time transaction rows, but productId
-- points at the reusable Product catalog row itself, so the unique
-- constraint made it impossible to ever sell the same retail item
-- twice. Confirmed live: a second sale of an already-sold product threw
-- a real Prisma unique-constraint violation.
DROP INDEX "Sale_productId_key";

-- Replaced with a plain (non-unique) index — productId is still queried/
-- joined on (product sales reporting, catalog lookups), it just no
-- longer needs to be one-row-per-product.
CREATE INDEX "Sale_productId_idx" ON "Sale"("productId");
