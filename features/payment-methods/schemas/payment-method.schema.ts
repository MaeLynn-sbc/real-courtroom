import { z } from "zod";

export const createPaymentMethodSchema = z.object({
  key: z
    .string()
    .min(1, "Enter a key.")
    .max(50)
    .regex(/^[A-Z0-9_]+$/, "Use uppercase letters, numbers, and underscores only."),
  label: z.string().min(1, "Enter a label.").max(100),
  sortOrder: z.coerce.number().int().optional(),
});

export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;

export const updatePaymentMethodSchema = z.object({
  label: z.string().min(1, "Enter a label.").max(100).optional(),
  sortOrder: z.coerce.number().int().optional(),
});

export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;
