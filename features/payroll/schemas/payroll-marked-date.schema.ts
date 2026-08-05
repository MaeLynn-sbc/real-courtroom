import { z } from "zod";

export const createMarkedDateSchema = z.object({
  date: z.coerce.date(),
  label: z.string().trim().min(1, "Enter a label.").max(200),
});

export type CreateMarkedDateInput = z.infer<typeof createMarkedDateSchema>;

export const deleteMarkedDateSchema = z.object({
  markedDateId: z.string().min(1),
});

export type DeleteMarkedDateInput = z.infer<typeof deleteMarkedDateSchema>;

export const updateMarkedDateSchema = z.object({
  markedDateId: z.string().min(1),
  date: z.coerce.date(),
  label: z.string().trim().min(1, "Enter a label.").max(200),
});

export type UpdateMarkedDateInput = z.infer<typeof updateMarkedDateSchema>;
