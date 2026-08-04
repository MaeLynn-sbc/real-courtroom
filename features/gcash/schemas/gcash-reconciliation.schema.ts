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

// Reported live (2026-08-04): a day confirmed too early (e.g. 8 AM, with
// most of the day's real sales still to come) had no way back to OPEN —
// undoing a mistaken close needed a real reason, same discipline as
// overrideStartingBalance.
export const reopenGcashBalanceSchema = z.object({
  date: z.string().min(1),
  reason: z.string().min(1, "Enter a reason for reopening this day."),
});
export type ReopenGcashBalanceInput = z.infer<typeof reopenGcashBalanceSchema>;
