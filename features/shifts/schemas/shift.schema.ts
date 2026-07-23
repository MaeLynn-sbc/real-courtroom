import { z } from "zod";

export const startShiftSchema = z.object({
  openingCashCents: z.coerce.number().int("Enter a whole peso amount.").min(0, "Can't be negative."),
  openingNotes: z.string().max(1000).optional(),
});
export type StartShiftInput = z.infer<typeof startShiftSchema>;

export const endShiftSchema = z.object({
  closingCashCents: z.coerce.number().int("Enter a whole peso amount.").min(0, "Can't be negative."),
  closingNotes: z.string().max(1000).optional(),
});
export type EndShiftInput = z.infer<typeof endShiftSchema>;
