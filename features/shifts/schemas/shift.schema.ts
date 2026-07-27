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
