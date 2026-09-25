"use server";

import {
  exportReportSchema,
  type ExportReportInput,
} from "@/features/reports/schemas/report.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  resolveDateRange,
  resolveMonthRange,
  type DateRange,
} from "@/services/analytics/date-range";
import {
  SALES_REPORT_EXCEL_COLUMNS,
  salesReportExcelTotals,
  toXlsx,
} from "@/services/export/excel.service";
import { expenseService } from "@/services/expenses/expense.service";
import { REPORT_CSV_COLUMNS, toCsv } from "@/services/export/export.service";
import { reportingService } from "@/services/reporting/reporting.service";
import { settingsService } from "@/services/settings/settings.service";
import { PERMISSIONS } from "@/types/permissions";

export interface ExportReportActionState {
  error: string | null;
  filename?: string;
  csv?: string;
}

export interface ExportReportExcelActionState {
  error: string | null;
  filename?: string;
  // base64 — a server action can't return a Buffer/Blob, and the client
  // turns this back into bytes for the download.
  xlsxBase64?: string;
}

// A CSV export can trigger a full-range report query on demand — cheap for
// a legitimate admin, but worth capping against a runaway client-side loop
// or a compromised admin session hammering the export button.
const EXPORT_RATE_LIMIT = 20;
const EXPORT_RATE_LIMIT_WINDOW_MS = 60 * 1000;

// The same precedence resolveDateRangeFromSearchParams applies on the
// screen: a picked month wins over from/to, so an export can never
// silently cover a different range than the table it was taken from.
function resolveExportCustomRange(
  range: ExportReportInput["range"],
): { from: Date; to: Date } | undefined {
  if (range.preset === "MONTH" && range.month) {
    return resolveMonthRange(range.month);
  }
  return range.from && range.to ? { from: range.from, to: range.to } : undefined;
}

function requireReportsManage() {
  return requirePermission(
    PERMISSIONS.REPORTS_MANAGE,
    "You don't have permission to view reports.",
  );
}

// A switch (rather than a keyed lookup over ReportType) so each branch's
// row type and column set stay concretely paired — TypeScript can't carry
// that pairing through a generic record indexed by a union key.
async function buildReportCsv(
  reportType: ExportReportInput["reportType"],
  range: DateRange,
  rolloverHour: number,
): Promise<string> {
  switch (reportType) {
    case "booking": {
      const { rows } = await reportingService.getBookingReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.booking);
    }
    case "courtUtilization": {
      const rows = await reportingService.getCourtUtilizationReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.courtUtilization);
    }
    case "tournament": {
      const rows = await reportingService.getTournamentReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.tournament);
    }
    case "membership": {
      const { rows } = await reportingService.getMembershipReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.membership);
    }
    case "coaching": {
      const { rows } = await reportingService.getCoachingReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.coaching);
    }
    case "equipmentRental": {
      const rows = await reportingService.getEquipmentRentalReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.equipmentRental);
    }
    case "lockerRental": {
      const rows = await reportingService.getLockerRentalReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.lockerRental);
    }
    case "expenses": {
      const rows = await expenseService.getExpensesReport(range);
      return toCsv(rows, REPORT_CSV_COLUMNS.expenses);
    }
    case "dailyReconciliation": {
      const rows = await reportingService.getDailyReconciliationReport(range, rolloverHour);
      return toCsv(rows, REPORT_CSV_COLUMNS.dailyReconciliation);
    }
    case "salesJournal": {
      const rows = await reportingService.getSalesJournal(range, rolloverHour);
      return toCsv(rows, REPORT_CSV_COLUMNS.salesJournal);
    }
    case "salesByCategory": {
      const rows = await reportingService.getSalesByCategoryReport(range, rolloverHour);
      return toCsv(rows, REPORT_CSV_COLUMNS.salesByCategory);
    }
    case "salesByPaymentMethod": {
      const rows = await reportingService.getSalesByPaymentMethodReport(range, rolloverHour);
      return toCsv(rows, REPORT_CSV_COLUMNS.salesByPaymentMethod);
    }
    case "salesByProduct": {
      const rows = await reportingService.getSalesByProductReport(range, rolloverHour);
      return toCsv(rows, REPORT_CSV_COLUMNS.salesByProduct);
    }
  }
}

// Owner request (2026-09-22): "can be exported to pdf or excel file".
// PDF is the browser's own print-to-PDF off a print stylesheet (nothing
// server-side); this is the Excel half. The sales report gets real peso
// columns and a totals row; every other report reuses its CSV columns
// verbatim, so no report silently claims formatting it doesn't have.
async function buildReportXlsx(
  reportType: ExportReportInput["reportType"],
  range: DateRange,
  rolloverHour: number,
  title: string,
): Promise<Buffer> {
  if (reportType === "dailyReconciliation") {
    const rows = await reportingService.getDailyReconciliationReport(range, rolloverHour);
    return toXlsx({
      sheetName: "Sales report",
      title,
      columns: SALES_REPORT_EXCEL_COLUMNS,
      rows,
      totals: salesReportExcelTotals(rows),
    });
  }

  // The CSV path already pairs each report type with its row shape; this
  // reuses that pairing rather than repeating the switch. The rows and
  // columns come from the same branch, so they always match.
  const csv = await buildReportCsv(reportType, range, rolloverHour);
  const [headerLine, ...dataLines] = csv.split("\r\n");
  const headers = splitCsvLine(headerLine ?? "");
  return toXlsx({
    sheetName: reportType.slice(0, 31),
    title,
    columns: headers.map((header, index) => ({
      header,
      value: (row: string[]) => coerceCell(row[index]),
    })),
    rows: dataLines.filter((line) => line.length > 0).map(splitCsvLine),
  });
}

// Minimal RFC 4180 reader for the round-trip above — toCsv is the only
// writer, so only quoted fields and doubled quotes can appear.
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

// Numbers land in Excel as numbers so they can be totalled; everything
// else stays the text it was.
function coerceCell(value: string | undefined): string | number | null {
  if (value === undefined || value === "") {
    return null;
  }
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
}

export async function exportReportExcelAction(
  input: ExportReportInput,
): Promise<ExportReportExcelActionState> {
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
    const courtHours = await settingsService.getCourtHours();
    const range = resolveDateRange(
      parsed.data.range.preset,
      resolveExportCustomRange(parsed.data.range),
      undefined,
      courtHours.businessDateRolloverHour,
    );
    const title = `${parsed.data.reportType === "dailyReconciliation" ? "Sales report" : parsed.data.reportType} — ${range.from.toDateString()} to ${range.to.toDateString()}`;
    const buffer = await buildReportXlsx(
      parsed.data.reportType,
      range,
      courtHours.businessDateRolloverHour,
      title,
    );
    const filename = `${parsed.data.reportType}-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return { error: null, filename, xlsxBase64: buffer.toString("base64") };
  } catch (error) {
    return {
      error: toActionError(error, { action: "exportReportExcelAction", userId: authz.userId }),
    };
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
    const courtHours = await settingsService.getCourtHours();
    const range = resolveDateRange(
      parsed.data.range.preset,
      resolveExportCustomRange(parsed.data.range),
      undefined,
      courtHours.businessDateRolloverHour,
    );

    const csv = await buildReportCsv(parsed.data.reportType, range, courtHours.businessDateRolloverHour);
    const filename = `${parsed.data.reportType}-report-${new Date().toISOString().slice(0, 10)}.csv`;

    return { error: null, filename, csv };
  } catch (error) {
    return {
      error: toActionError(error, { action: "exportReportCsvAction", userId: authz.userId }),
    };
  }
}
