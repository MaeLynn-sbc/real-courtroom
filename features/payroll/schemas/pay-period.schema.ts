import { z } from "zod";

// Owner request (2026-08-06): the periods page only ever auto-generates
// the trailing couple of months — an older date the auto-generation
// never reached (e.g. backfilling history) needs a manual way in, same
// "make everything editable" pattern as update/delete below.
export const createPayPeriodSchema = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be on or after the start date.",
    path: ["endDate"],
  });

export type CreatePayPeriodInput = z.infer<typeof createPayPeriodSchema>;

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
