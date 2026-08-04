import { z } from "zod";

export const seedCashBalanceSchema = z.object({
  startingBalanceCents: z.coerce
    .number()
    .int("Enter a whole peso amount.")
    .min(0, "Can't be negative."),
});
export type SeedCashBalanceInput = z.infer<typeof seedCashBalanceSchema>;

export const confirmCashBalanceSchema = z
  .object({
    date: z.string().min(1),
    confirmedEndingBalanceCents: z.coerce
      .number()
      .int("Enter a whole peso amount.")
      .min(0, "Can't be negative."),
    // Cash pulled for the bank/safe at close — the rest stays in the
    // drawer and becomes tomorrow's starting balance. Defaults to 0 (all
    // of it stays), not required.
    withdrawnCents: z.coerce
      .number()
      .int("Enter a whole peso amount.")
      .min(0, "Can't be negative.")
      .default(0),
    notes: z.string().max(1000).optional(),
  })
  .refine((value) => value.withdrawnCents <= value.confirmedEndingBalanceCents, {
    message: "Cash withdrawn can't be more than the confirmed drawer count.",
    path: ["withdrawnCents"],
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

// Reported live (2026-08-04): a day confirmed too early (e.g. 8 AM, with
// most of the day's real sales still to come) had no way back to OPEN —
// undoing a mistaken close needed a real reason, same discipline as
// overrideStartingBalance.
export const reopenCashBalanceSchema = z.object({
  date: z.string().min(1),
  reason: z.string().min(1, "Enter a reason for reopening this day."),
});
export type ReopenCashBalanceInput = z.infer<typeof reopenCashBalanceSchema>;
