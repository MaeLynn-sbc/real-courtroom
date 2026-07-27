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
