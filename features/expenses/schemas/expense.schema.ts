import { z } from "zod";

// Receipt is OPTIONAL (spec point 4) — description is required regardless
// of whether one is attached, so it carries the schema's only required
// z.string().min(1) beyond amount/date/category/paymentMethod.
export const createExpenseSchema = z.object({
  amountCents: z.coerce.number().int().positive("Enter an amount."),
  date: z.string().min(1, "Pick a date."),
  description: z.string().min(1, "Enter a description.").max(500),
  categoryId: z.string().min(1, "Pick a category."),
  paymentMethodId: z.string().min(1, "Pick a payment method."),
  receipt: z
    .object({
      fileName: z.string().min(1),
      contentType: z.string().min(1),
      dataBase64: z.string().min(1),
    })
    .optional(),
  // Set only on a second attempt, after the caller has been shown the
  // matching expense already on file and has said to record this one
  // anyway. See expenseService.findRecentDuplicate — the duplicate check
  // warns, it never blocks, because two coaches really can be paid the
  // same amount on the same night.
  confirmDuplicate: z.boolean().optional(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

// Reversing an expense that should not have been recorded (owner-reported
// duplicate coach payout, 2026-09-21). Reason required — it is the only
// durable answer to "why did this P8,200 come off the books".
export const voidExpenseSchema = z.object({
  expenseId: z.string().min(1),
  reason: z.string().trim().min(1, "Enter a reason for this reversal."),
});

export type VoidExpenseInput = z.infer<typeof voidExpenseSchema>;
