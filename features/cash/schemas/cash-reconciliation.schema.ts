import { z } from "zod";

export const seedCashBalanceSchema = z.object({
  startingBalanceCents: z.coerce
    .number()
    .int("Enter a whole peso amount.")
    .min(0, "Can't be negative."),
});
export type SeedCashBalanceInput = z.infer<typeof seedCashBalanceSchema>;

export const confirmCashBalanceSchema = z.object({
  date: z.string().min(1),
  confirmedEndingBalanceCents: z.coerce
    .number()
    .int("Enter a whole peso amount.")
    .min(0, "Can't be negative."),
  notes: z.string().max(1000).optional(),
});
export type ConfirmCashBalanceInput = z.infer<typeof confirmCashBalanceSchema>;

export const overrideCashStartingBalanceSchema = z.object({
  date: z.string().min(1),
  newStartingBalanceCents: z.coerce
    .number()
    .int("Enter a whole peso amount.")
    .min(0, "Can't be negative."),
  reason: z.string().min(1, "Enter a reason for this correction."),
});
export type OverrideCashStartingBalanceInput = z.infer<typeof overrideCashStartingBalanceSchema>;
