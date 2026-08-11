import { z } from "zod";

const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time as HH:MM.");

export const createShiftTemplateSchema = z.object({
  name: z.string().trim().min(1, "Enter a name for this shift."),
  startTime: timeString,
  endTime: timeString,
});

export type CreateShiftTemplateInput = z.infer<typeof createShiftTemplateSchema>;

export const updateShiftTemplateSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().trim().min(1, "Enter a name for this shift."),
  startTime: timeString,
  endTime: timeString,
});

export type UpdateShiftTemplateInput = z.infer<typeof updateShiftTemplateSchema>;

export const setShiftTemplateActiveSchema = z.object({
  templateId: z.string().min(1),
  active: z.boolean(),
});

export type SetShiftTemplateActiveInput = z.infer<typeof setShiftTemplateActiveSchema>;
