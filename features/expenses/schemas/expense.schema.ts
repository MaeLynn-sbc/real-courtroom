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
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
