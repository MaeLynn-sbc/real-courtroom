import { z } from "zod";

export const createEmployeeRateSchema = z.object({
  employeeId: z.string().min(1, "Select an employee."),
  dailyRateCents: z.coerce.number().int().positive("Enter a daily rate greater than zero."),
  effectiveFrom: z.coerce.date(),
  note: z.string().max(500).optional(),
});

export type CreateEmployeeRateInput = z.infer<typeof createEmployeeRateSchema>;

export const deleteEmployeeRateSchema = z.object({
  rateId: z.string().min(1),
});

export type DeleteEmployeeRateInput = z.infer<typeof deleteEmployeeRateSchema>;
