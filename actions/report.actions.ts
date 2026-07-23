"use server";

import { exportReportSchema, type ExportReportInput } from "@/features/reports/schemas/report.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveDateRange, type DateRange } from "@/services/analytics/date-range";
import { REPORT_CSV_COLUMNS, toCsv } from "@/services/export/export.service";
import { reportingService } from "@/services/reporting/reporting.service";
import { PERMISSIONS } from "@/types/permissions";

export interface ExportReportActionState {
  error: string | null;
  filename?: string;
  csv?: string;
}

// A CSV export can trigger a full-range report query on demand — cheap for
// a legitimate admin, but worth capping against a runaway client-side loop
// or a compromised admin session hammering the export button.
const EXPORT_RATE_LIMIT = 20;
const EXPORT_RATE_LIMIT_WINDOW_MS = 60 * 1000;

function requireReportsManage() {
  return requirePermission(PERMISSIONS.REPORTS_MANAGE, "You don't have permission to view reports.");
}

// A switch (rather than a keyed lookup over ReportType) so each branch's
// row type and column set stay concretely paired — TypeScript can't carry
// that pairing through a generic record indexed by a union key.
async function buildReportCsv(reportType: ExportReportInput["reportType"], range: DateRange): Promise<string> {
  switch (reportType) {
    case "booking": {
      const { rows } = await reportingService.getBookingReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.booking);
    }
    case "courtUtilization": {
      const rows = await reportingService.getCourtUtilizationReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.courtUtilization);
    }
    case "openPlay": {
      const rows = await reportingService.getOpenPlayReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.openPlay);
    }
    case "tournament": {
      const rows = await reportingService.getTournamentReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.tournament);
    }
    case "membership": {
      const { rows } = await reportingService.getMembershipReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.membership);
    }
    case "equipmentRental": {
      const rows = await reportingService.getEquipmentRentalReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.equipmentRental);
    }
    case "lockerRental": {
      const rows = await reportingService.getLockerRentalReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.lockerRental);
    }
    case "salesByCategory": {
      const rows = await reportingService.getSalesByCategoryReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.salesByCategory);
    }
    case "salesByPaymentMethod": {
      const rows = await reportingService.getSalesByPaymentMethodReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.salesByPaymentMethod);
    }
  }
}

export async function exportReportCsvAction(
  input: ExportReportInput,
): Promise<ExportReportActionState> {
  const authz = await requireReportsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const rateLimit = checkRateLimit(
    `export-report:${authz.userId}`,
    EXPORT_RATE_LIMIT,
    EXPORT_RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return { error: "Too many exports — please wait a moment and try again." };
  }

  const parsed = exportReportSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid export request." };
  }

  try {
    const range = resolveDateRange(
      parsed.data.range.preset,
      parsed.data.range.from && parsed.data.range.to
        ? { from: parsed.data.range.from, to: parsed.data.range.to }
        : undefined,
    );

    const csv = await buildReportCsv(parsed.data.reportType, range);
    const filename = `${parsed.data.reportType}-report-${new Date().toISOString().slice(0, 10)}.csv`;

    return { error: null, filename, csv };
  } catch (error) {
    return {
      error: toActionError(error, { action: "exportReportCsvAction", userId: authz.userId }),
    };
  }
}
