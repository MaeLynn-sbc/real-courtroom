-- Owner-editable stock count per product, defaulting to 0 for existing
-- rows (an explicit owner action to set a real starting count, not an
-- assumed value) — decremented atomically on each sale.
ALTER TABLE "Product" ADD COLUMN "stockCount" INTEGER NOT NULL DEFAULT 0;
