import ExcelJS from "exceljs";

import { toDateValue } from "@/lib/date-value";

import type { DailyReconciliationRow } from "@/services/reporting/reporting.service";

// Owner request (2026-09-22): the sales report has to leave the app as a
// real Excel file, not only CSV — a month-end sheet gets handed to someone
// who works in Excel, and "Total Sales (cents)" columns of raw integers
// are not that. A workbook lets each money column carry a peso number
// format, so the file opens with ₱1,234.50 in a cell that still sums.
//
// CSV stays alongside it (owner asked to keep it): same data, no
// formatting, and the one format that opens anywhere.
export interface ExcelColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | Date | null | undefined;
  // Peso amounts are passed as whole pesos (cents / 100) and given this
  // format, so the cell is a NUMBER Excel can total — never a string like
  // "₱1,234.50", which sums to zero.
  money?: boolean;
  width?: number;
}

const PESO_FORMAT = '"₱"#,##0.00;[Red]-"₱"#,##0.00';

// Cents -> pesos, for a money column. Null stays null so an unopened till
// shows as an empty cell rather than a confident ₱0.00 — the same
// distinction the on-screen table draws with a dash.
export function pesos(cents: number | null | undefined): number | null {
  return cents === null || cents === undefined ? null : cents / 100;
}

// The sales report's own money-aware columns, in the screen's order.
// The sheet carries a few the table leaves out — each till's starting
// balance and status — because a spreadsheet has room for them and an
// accountant checking a month wants the full ledger, not the scannable
// subset the screen shows.
export const SALES_REPORT_EXCEL_COLUMNS: ExcelColumn<DailyReconciliationRow>[] = [
  { header: "Date", value: (r) => toDateValue(r.date), width: 12 },
  { header: "Transactions", value: (r) => r.transactionCount },
  { header: "Total sales", value: (r) => r.totalSalesCents, money: true, width: 14 },
  { header: "Cash sales", value: (r) => r.cashSalesCents, money: true, width: 14 },
  { header: "GCash sales", value: (r) => r.gcashSalesCents, money: true, width: 14 },
  { header: "Cash expenses", value: (r) => r.cashExpensesCents, money: true, width: 15 },
  { header: "GCash expenses", value: (r) => r.gcashExpensesCents, money: true, width: 15 },
  { header: "Total expenses", value: (r) => r.totalExpensesCents, money: true, width: 15 },
  { header: "Cash starting", value: (r) => r.cashStartingCents, money: true, width: 14 },
  { header: "Cash expected", value: (r) => r.cashExpectedCents, money: true, width: 14 },
  { header: "Cash counted", value: (r) => r.cashCountedCents, money: true, width: 14 },
  { header: "Deposited", value: (r) => r.cashDepositedCents, money: true, width: 14 },
  { header: "Cash variance", value: (r) => r.cashVarianceCents, money: true, width: 14 },
  { header: "Cash status", value: (r) => r.cashStatus, width: 13 },
  { header: "GCash starting", value: (r) => r.gcashStartingCents, money: true, width: 15 },
  { header: "GCash expected", value: (r) => r.gcashExpectedCents, money: true, width: 15 },
  { header: "GCash counted", value: (r) => r.gcashCountedCents, money: true, width: 15 },
  { header: "GCash variance", value: (r) => r.gcashVarianceCents, money: true, width: 15 },
  { header: "GCash status", value: (r) => r.gcashStatus, width: 13 },
  { header: "Total variance", value: (r) => r.totalVarianceCents, money: true, width: 15 },
];

// Column totals for the sheet's bottom row. Running balances (starting,
// expected, counted) are deliberately blank: they carry night to night,
// so summing them down a month adds the same money over and over. The
// variance totals count only the days someone actually closed — summing
// nulls as zero would read as "these days balanced".
export function salesReportExcelTotals(
  rows: DailyReconciliationRow[],
): (string | number | null)[] {
  const sum = (pick: (r: DailyReconciliationRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  const sumKnown = (pick: (r: DailyReconciliationRow) => number | null) => {
    const known = rows.map(pick).filter((value): value is number => value !== null);
    return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
  };
  return [
    `${rows.length} ${rows.length === 1 ? "day" : "days"}`,
    sum((r) => r.transactionCount),
    pesos(sum((r) => r.totalSalesCents)),
    pesos(sum((r) => r.cashSalesCents)),
    pesos(sum((r) => r.gcashSalesCents)),
    pesos(sum((r) => r.cashExpensesCents)),
    pesos(sum((r) => r.gcashExpensesCents)),
    pesos(sum((r) => r.totalExpensesCents)),
    null,
    null,
    null,
    pesos(sumKnown((r) => r.cashDepositedCents)),
    pesos(sumKnown((r) => r.cashVarianceCents)),
    null,
    null,
    null,
    null,
    pesos(sumKnown((r) => r.gcashVarianceCents)),
    null,
    pesos(sumKnown((r) => r.totalVarianceCents)),
  ];
}

export interface ExcelSheetOptions<T> {
  sheetName: string;
  title?: string;
  columns: ExcelColumn<T>[];
  rows: T[];
  // One cell per column, in the same order, for a bold totals row. Money
  // entries are already in pesos. Undefined entries render empty.
  totals?: (string | number | null | undefined)[];
}

export async function toXlsx<T>(options: ExcelSheetOptions<T>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "The Courtroom";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(options.sheetName.slice(0, 31));

  if (options.title) {
    const titleRow = sheet.addRow([options.title]);
    titleRow.font = { bold: true, size: 14 };
    sheet.mergeCells(titleRow.number, 1, titleRow.number, options.columns.length);
    sheet.addRow([]);
  }

  const headerRow = sheet.addRow(options.columns.map((column) => column.header));
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  });
  sheet.views = [{ state: "frozen", ySplit: headerRow.number }];

  for (const row of options.rows) {
    const values = options.columns.map((column) => {
      const raw = column.value(row);
      if (raw === undefined) {
        return null;
      }
      return column.money && typeof raw === "number" ? raw / 100 : raw;
    });
    sheet.addRow(values);
  }

  if (options.totals) {
    const totalsRow = sheet.addRow(options.totals.map((value) => value ?? null));
    totalsRow.font = { bold: true };
    totalsRow.border = { top: { style: "thin" } };
  }

  options.columns.forEach((column, index) => {
    const sheetColumn = sheet.getColumn(index + 1);
    sheetColumn.width = column.width ?? Math.max(12, column.header.length + 2);
    if (column.money) {
      sheetColumn.numFmt = PESO_FORMAT;
    }
  });

  // ExcelJS types this as the DOM's ArrayBuffer-ish union; the Node build
  // really does hand back a Buffer.
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}
