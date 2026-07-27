import { z } from "zod";

export const createExpenseCategorySchema = z.object({
  name: z.string().min(1, "Enter a name.").max(100),
  sortOrder: z.coerce.number().int().optional(),
});

export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;

export const updateExpenseCategorySchema = z.object({
  name: z.string().min(1, "Enter a name.").max(100).optional(),
  sortOrder: z.coerce.number().int().optional(),
});

export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategorySchema>;
