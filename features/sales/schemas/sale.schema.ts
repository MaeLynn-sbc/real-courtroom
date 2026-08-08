import { z } from "zod";

// Owner request (2026-08-08): a real, audit-logged correction for when an
// attendant records a Cash payment as GCash (or the reverse) — see
// saleService.correctPaymentMethod's own comment. Same shape as
// player-tab.schema.ts's writeOffTabInputSchema (required, non-empty,
// length-capped reason).
export const correctSalePaymentMethodInputSchema = z.object({
  saleId: z.string().min(1),
  fromPaymentMethodId: z.string().min(1),
  toPaymentMethodId: z.string().min(1),
  reason: z.string().min(1, "A reason is required.").max(500),
});

export type CorrectSalePaymentMethodInput = z.infer<typeof correctSalePaymentMethodInputSchema>;
