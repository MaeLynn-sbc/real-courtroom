import { z } from "zod";

export const createProductSchema = z.object({
  name: z.string().min(1, "Enter a product name.").max(200),
  priceCents: z.coerce.number().int().nonnegative("Price can't be negative."),
  stockCount: z.coerce.number().int().nonnegative("Stock can't be negative.").default(0),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  name: z.string().min(1, "Enter a product name.").max(200),
  priceCents: z.coerce.number().int().nonnegative("Price can't be negative."),
  active: z.boolean(),
  stockCount: z.coerce.number().int().nonnegative("Stock can't be negative."),
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const reorderProductsSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

export type ReorderProductsInput = z.infer<typeof reorderProductsSchema>;

export const sellProductSchema = z.object({
  productId: z.string().min(1, "Select a product."),
  quantity: z.coerce.number().int().positive().optional(),
  paymentMethodId: z.string().min(1, "Select a payment method."),
  playerId: z.string().min(1).optional(),
});

export type SellProductInput = z.infer<typeof sellProductSchema>;

// For an occasional consignment item that doesn't warrant a permanent
// catalog entry (Product) — the attendant types the name and price
// instead of picking from the grid. No productId, no stock decrement:
// there's no Product row to decrement. Same SaleCategory.OTHER shape
// already used by recordManualSaleAction (actions/shift.actions.ts) —
// "no linked source row" is exactly what OTHER exists for — but scoped
// to the Shop page's own EQUIPMENT_MANAGE permission (any attendant who
// can sell a catalog item can sell a consignment one), not the
// stricter, owner/manager-only SALES_RECORD_MANUAL.
export const sellCustomItemSchema = z.object({
  description: z.string().min(1, "Enter what you're selling.").max(200),
  unitPriceCents: z.coerce.number().int().positive("Enter a price."),
  quantity: z.coerce.number().int().positive().default(1),
  paymentMethodId: z.string().min(1, "Select a payment method."),
  playerId: z.string().min(1).optional(),
});

export type SellCustomItemInput = z.infer<typeof sellCustomItemSchema>;
