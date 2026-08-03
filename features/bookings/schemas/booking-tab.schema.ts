import { z } from "zod";

export const addBookingProductLineItemInputSchema = z.object({
  bookingId: z.string().min(1),
  productId: z.string().min(1),
  qty: z.number().int().positive(),
});

export type AddBookingProductLineItemInput = z.infer<typeof addBookingProductLineItemInputSchema>;

export const voidBookingTabLineItemInputSchema = z.object({
  bookingId: z.string().min(1),
  lineItemId: z.string().min(1),
  reason: z.string().min(1, "A reason is required.").max(500),
});

export type VoidBookingTabLineItemInput = z.infer<typeof voidBookingTabLineItemInputSchema>;

export const settleBookingTabInputSchema = z.object({
  bookingId: z.string().min(1),
  method: z.enum(["CASH", "GCASH"]),
  gcashReference: z.string().max(100).optional(),
  paymentMethodId: z.string().min(1),
});

export type SettleBookingTabInput = z.infer<typeof settleBookingTabInputSchema>;

export const writeOffBookingTabInputSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().min(1, "A reason is required.").max(500),
});

export type WriteOffBookingTabInput = z.infer<typeof writeOffBookingTabInputSchema>;
