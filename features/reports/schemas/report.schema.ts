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
//
// This is a Zod (application-level) enum only, not a Prisma/database one
// — `reportType` is never a persisted column anywhere (confirmed against
// schema.prisma), just a URL route param and action input. Removing
// "openPlay" here needed no migration and put no existing row at risk —
// confirmed live against the dev database: no Setting row and no
// AuditLog entry references it anywhere. A stale link to
// /dashboard/reports/openPlay now 404s cleanly (app/dashboard/reports/
// [reportType]/page.tsx's existing safeParse + notFound()), it doesn't
// crash or silently render wrong data.
export const reportTypeSchema = z.enum([
  "booking",
  "courtUtilization",
  "tournament",
  "membership",
  "coaching",
  "equipmentRental",
  "lockerRental",
  "salesByCategory",
  "salesByPaymentMethod",
  "salesByProduct",
]);

export type ReportTypeInput = z.infer<typeof reportTypeSchema>;

export const exportReportSchema = z.object({
  reportType: reportTypeSchema,
  range: dateRangeSchema,
});

export type ExportReportInput = z.infer<typeof exportReportSchema>;
