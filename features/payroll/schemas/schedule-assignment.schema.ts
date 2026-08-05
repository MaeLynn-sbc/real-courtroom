import { z } from "zod";

// Discriminated at the object-shape level, not with z.discriminatedUnion's
// literal-tag field — the client sends either a templateId (pick a named
// shift) or a pair of custom times (isOverride), never both, same
// either/or shape scheduleAssignmentService.AssignDayInput already models.
export const assignDaySchema = z
  .object({
    employeeId: z.string().min(1, "Select an employee."),
    workDate: z.coerce.date(),
    templateId: z.string().optional(),
    scheduledStart: z.coerce.date().optional(),
    scheduledEnd: z.coerce.date().optional(),
    note: z.string().max(500).optional(),
  })
  .refine((data) => Boolean(data.templateId) !== Boolean(data.scheduledStart), {
    message: "Pick a shift template, or enter custom start/end times — not both.",
    path: ["templateId"],
  })
  .refine((data) => !data.scheduledStart || Boolean(data.scheduledEnd), {
    message: "Enter both a start and an end time for custom hours.",
    path: ["scheduledEnd"],
  });

export type AssignDayFormInput = z.infer<typeof assignDaySchema>;

export const clearDaySchema = z.object({
  employeeId: z.string().min(1),
  workDate: z.coerce.date(),
});

export type ClearDayInput = z.infer<typeof clearDaySchema>;

export const bulkAssignSchema = z
  .object({
    employeeId: z.string().min(1, "Select an employee."),
    templateId: z.string().min(1, "Select a shift template."),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    note: z.string().max(500).optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be on or after the start date.",
    path: ["endDate"],
  });

export type BulkAssignInput = z.infer<typeof bulkAssignSchema>;
