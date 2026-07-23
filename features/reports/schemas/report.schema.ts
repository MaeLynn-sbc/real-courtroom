import { z } from "zod";

export const dateRangeSchema = z.object({
  preset: z.enum(["TODAY", "7_DAYS", "30_DAYS", "90_DAYS", "CUSTOM"]),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type DateRangeInput = z.infer<typeof dateRangeSchema>;

export const reportTypeSchema = z.enum([
  "booking",
  "courtUtilization",
  "openPlay",
  "tournament",
  "membership",
  "equipmentRental",
  "lockerRental",
  "salesByCategory",
  "salesByPaymentMethod",
]);

export type ReportTypeInput = z.infer<typeof reportTypeSchema>;

export const exportReportSchema = z.object({
  reportType: reportTypeSchema,
  range: dateRangeSchema,
});

export type ExportReportInput = z.infer<typeof exportReportSchema>;
