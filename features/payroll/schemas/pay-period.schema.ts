import { z } from "zod";

export const updatePayPeriodSchema = z
  .object({
    periodId: z.string().min(1),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be on or after the start date.",
    path: ["endDate"],
  });

export type UpdatePayPeriodInput = z.infer<typeof updatePayPeriodSchema>;

export const deletePayPeriodSchema = z.object({
  periodId: z.string().min(1),
});

export type DeletePayPeriodInput = z.infer<typeof deletePayPeriodSchema>;
