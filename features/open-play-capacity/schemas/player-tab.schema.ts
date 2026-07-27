import { z } from "zod";

export const settleTabInputSchema = z.object({
  tabId: z.string().min(1),
  method: z.enum(["CASH", "GCASH"]),
  gcashReference: z.string().max(100).optional(),
  paymentMethodId: z.string().min(1),
});

export type SettleTabInput = z.infer<typeof settleTabInputSchema>;

export const addRentalLineItemInputSchema = z.object({
  tabId: z.string().min(1),
  equipmentKey: z.string().min(1),
  description: z.string().min(1).max(200),
  qty: z.number().int().positive(),
});

export type AddRentalLineItemInput = z.infer<typeof addRentalLineItemInputSchema>;

// Open-play queue/tabs screen batch: "+ Add-on" — same shape as
// addRentalLineItemInputSchema above, productId in place of
// equipmentKey/description (the Product record already has both a name
// and a price; nothing extra to enter).
export const addProductLineItemInputSchema = z.object({
  tabId: z.string().min(1),
  productId: z.string().min(1),
  qty: z.number().int().positive(),
});

export type AddProductLineItemInput = z.infer<typeof addProductLineItemInputSchema>;

export const addAdjustmentInputSchema = z.object({
  tabId: z.string().min(1),
  description: z.string().min(1, "Enter a description.").max(200),
  amountCents: z.number().int(),
  reason: z.string().min(1, "A reason is required.").max(500),
});

export type AddAdjustmentInput = z.infer<typeof addAdjustmentInputSchema>;

export const voidLineItemInputSchema = z.object({
  tabId: z.string().min(1),
  lineItemId: z.string().min(1),
  reason: z.string().min(1, "A reason is required.").max(500),
});

export type VoidLineItemInput = z.infer<typeof voidLineItemInputSchema>;

export const writeOffTabInputSchema = z.object({
  tabId: z.string().min(1),
  reason: z.string().min(1, "A reason is required.").max(500),
});

export type WriteOffTabInput = z.infer<typeof writeOffTabInputSchema>;

export const closeSessionInputSchema = z.object({
  sessionId: z.string().min(1),
});

export type CloseSessionInput = z.infer<typeof closeSessionInputSchema>;
