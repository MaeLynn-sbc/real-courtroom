-- Open-play queue/tabs screen batch: "+ Add-on" reuses the existing
-- Product catalog (name+price+active, already admin-editable at
-- /dashboard/admin/products) instead of building a second, parallel
-- item list. TabLineItemType needs a new value so an add-on can be
-- charged onto a tab the same way a RENTAL line item already can.

-- AlterEnum
ALTER TYPE "TabLineItemType" ADD VALUE 'PRODUCT';
