import { z } from "zod";

export const seedGcashBalanceSchema = z.object({
  startingBalanceCents: z.coerce.number().int("Enter a whole peso amount.").min(0, "Can't be negative."),
});
export type SeedGcashBalanceInput = z.infer<typeof seedGcashBalanceSchema>;

export const confirmGcashBalanceSchema = z.object({
  date: z.string().min(1),
  confirmedEndingBalanceCents: z.coerce.number().int("Enter a whole peso amount.").min(0, "Can't be negative."),
  notes: z.string().max(1000).optional(),
});
export type ConfirmGcashBalanceInput = z.infer<typeof confirmGcashBalanceSchema>;

export const overrideGcashStartingBalanceSchema = z.object({
  date: z.string().min(1),
  newStartingBalanceCents: z.coerce.number().int("Enter a whole peso amount.").min(0, "Can't be negative."),
  reason: z.string().min(1, "Enter a reason for this correction."),
});
export type OverrideGcashStartingBalanceInput = z.infer<typeof overrideGcashStartingBalanceSchema>;
