import { z } from "zod";

export const dateRangeSchema = z.object({
  preset: z.enum(["TODAY", "7_DAYS", "30_DAYS", "90_DAYS", "CUSTOM"]),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type DateRangeInput = z.infer<typeof dateRangeSchema>;

// "openPlay" was removed here (Phase 7 review) — it read from the old,
// dormant OpenPlaySession model and rendered plausible-looking but wrong
// numbers for the current Open Play Nights feature. Open play revenue now
// lives at /dashboard/sales (services/open-play/open-play-sales.service.ts),
// reading real PlayerTab/Sale data. Not repaired and not re-added under
// this key — a correct open-play report belongs at /dashboard/sales, not
// back in this switch.
export const reportTypeSchema = z.enum([
  "booking",
  "courtUtilization",
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
