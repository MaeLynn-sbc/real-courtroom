import { z } from "zod";

export const startShiftSchema = z.object({
  openingCashCents: z.coerce.number().int("Enter a whole peso amount.").min(0, "Can't be negative."),
  openingNotes: z.string().max(1000).optional(),
});
export type StartShiftInput = z.infer<typeof startShiftSchema>;

// Gate 1: staff enter a QUANTITY per denomination, not one manual total
// — closingCashCents no longer exists as an input at all.
// shiftService.endShift computes it FROM this breakdown
// (sumCashDenominationBreakdown), the one authoritative place, never
// trusting a client-submitted total for money. closingNotes stays
// optional at the schema layer — "required only when variance != 0" is
// enforced in the service, since only the service knows the variance
// (it depends on a live Sale query, not just this input).
export const endShiftSchema = z.object({
  closingCashBreakdown: z.record(z.string(), z.number().int().nonnegative()),
  closingNotes: z.string().max(1000).optional(),
});
export type EndShiftInput = z.infer<typeof endShiftSchema>;

// Reported live: cash that comes in outside every modelled revenue flow
// had nowhere to go — staff recorded it on paper, invisible to every
// report and shift reconciliation. note is required (not optional) —
// unlike a product sale (which already has a product name) or a booking
// fee (which already has a linked record), this note is the ONLY record
// of what the money actually was.
export const manualSaleInputSchema = z.object({
  amountCents: z.coerce.number().int("Enter a whole peso amount.").positive("Enter an amount greater than zero."),
  paymentMethodId: z.string().min(1, "Select a payment method."),
  gcashReference: z.string().max(200).optional(),
  note: z.string().trim().min(1, "Enter a note describing what this sale was.").max(1000),
});
export type ManualSaleInput = z.infer<typeof manualSaleInputSchema>;
