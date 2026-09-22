import ExcelJS from "exceljs";

import {
  SALES_REPORT_EXCEL_COLUMNS,
  salesReportExcelTotals,
  toXlsx,
} from "@/services/export/excel.service";
import type { DailyReconciliationRow } from "@/services/reporting/reporting.service";

function row(overrides: Partial<DailyReconciliationRow> = {}): DailyReconciliationRow {
  return {
    date: new Date(2026, 7, 1),
    transactionCount: 0,
    totalSalesCents: 0,
    cashSalesCents: 0,
    gcashSalesCents: 0,
    otherSalesCents: 0,
    cashExpensesCents: 0,
    gcashExpensesCents: 0,
    otherExpensesCents: 0,
    totalExpensesCents: 0,
    cashStartingCents: null,
    cashExpectedCents: null,
    cashCountedCents: null,
    cashVarianceCents: null,
    cashDepositedCents: null,
    cashStatus: null,
    gcashStartingCents: null,
    gcashExpectedCents: null,
    gcashCountedCents: null,
    gcashVarianceCents: null,
    gcashStatus: null,
    totalVarianceCents: null,
    ...overrides,
  };
}

describe("salesReportExcelTotals", () => {
  it("returns exactly one entry per column, so the totals row can't shift", () => {
    expect(salesReportExcelTotals([row()])).toHaveLength(SALES_REPORT_EXCEL_COLUMNS.length);
  });

  it("totals money columns in pesos, not cents", () => {
    const totals = salesReportExcelTotals([
      row({ totalSalesCents: 70000, cashSalesCents: 70000 }),
      row({ totalSalesCents: 35000, gcashSalesCents: 35000 }),
    ]);
    const totalSalesIndex = SALES_REPORT_EXCEL_COLUMNS.findIndex((c) => c.header === "Total sales");
    expect(totals[totalSalesIndex]).toBe(1050);
  });

  it("leaves running balances out of the totals — they carry night to night", () => {
    const totals = salesReportExcelTotals([row({ cashStartingCents: 100000 })]);
    for (const header of ["Cash starting", "Cash expected", "Cash counted", "GCash starting"]) {
      expect(totals[SALES_REPORT_EXCEL_COLUMNS.findIndex((c) => c.header === header)]).toBeNull();
    }
  });

  it("counts only the days a till was actually closed, so unclosed days don't read as balanced", () => {
    const varianceIndex = SALES_REPORT_EXCEL_COLUMNS.findIndex(
      (c) => c.header === "Total variance",
    );
    expect(salesReportExcelTotals([row(), row()])[varianceIndex]).toBeNull();
    expect(
      salesReportExcelTotals([row({ totalVarianceCents: -70000 }), row()])[varianceIndex],
    ).toBe(-700);
  });
});

describe("toXlsx", () => {
  it("writes a readable workbook with a header, the rows, and a totals row", async () => {
    const rows = [row({ transactionCount: 3, totalSalesCents: 70000, cashSalesCents: 70000 })];
    const buffer = await toXlsx({
      sheetName: "Sales report",
      title: "Sales report — August",
      columns: SALES_REPORT_EXCEL_COLUMNS,
      rows,
      totals: salesReportExcelTotals(rows),
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Sales report");
    expect(sheet).toBeDefined();
    // Title, blank, header, one data row, totals.
    expect(sheet!.rowCount).toBe(5);
    expect(sheet!.getRow(3).getCell(1).value).toBe("Date");
    // Reported live (2026-09-22): the sheet and the screen both labelled
    // every business date one day early, because local midnight is the
    // previous day in UTC. Aug 1 must read as Aug 1.
    expect(sheet!.getRow(4).getCell(1).value).toBe("2026-08-01");
    // Money cells are numbers in pesos — a string like "₱700.00" would
    // sum to zero in Excel, which is the whole point of the xlsx export.
    expect(sheet!.getRow(4).getCell(3).value).toBe(700);
    expect(sheet!.getRow(5).getCell(3).value).toBe(700);
  });

  it("leaves an unreconciled day's cells empty rather than zero", async () => {
    const buffer = await toXlsx({
      sheetName: "Sales report",
      columns: SALES_REPORT_EXCEL_COLUMNS,
      rows: [row()],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Sales report")!;
    const countedIndex = SALES_REPORT_EXCEL_COLUMNS.findIndex((c) => c.header === "Cash counted");
    expect(sheet.getRow(2).getCell(countedIndex + 1).value).toBeNull();
  });
});
