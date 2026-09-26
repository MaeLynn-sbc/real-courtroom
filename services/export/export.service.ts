import { toDateValue } from "@/lib/date-value";
import type {
  DailyReconciliationRow,
  BookingReportRow,
  CoachingReportRow,
  CourtUtilizationRow,
  EquipmentRentalReportRow,
  LockerRentalReportRow,
  MembershipReportRow,
  SalesByCategoryRow,
  SalesByPaymentMethodRow,
  SalesByProductRow,
  TournamentReportRow,
} from "@/services/reporting/reporting.service";
import type { ExpenseReportRow } from "@/services/expenses/expense.service";
import type { SalesJournalRow } from "@/services/reporting/reporting.service";
import type { ShiftReconciliationRow } from "@/services/shift/shift.service";

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | Date | null | undefined;
}

// Pure — no Prisma import, unit-tested directly. Escapes a field only when
// it needs it (contains a comma, quote, or newline), per RFC 4180: wrap in
// double quotes and double any embedded double quotes.
function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCsvValue(value: string | number | boolean | Date | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const headerLine = columns.map((column) => escapeCsvField(column.header)).join(",");
  const lines = rows.map((row) =>
    columns.map((column) => escapeCsvField(formatCsvValue(column.value(row)))).join(","),
  );
  return [headerLine, ...lines].join("\r\n");
}

// Thin per-report column mappings — each maps a reporting.service.ts
// result shape to the exact rows shown on screen, so the CSV always
// matches the displayed report. Registered by report type so
// actions/report.actions.ts can dispatch on a single string param instead
// of switching on report shape itself.

export const REPORT_CSV_COLUMNS = {
  booking: [
    { header: "Booking Reference", value: (r: BookingReportRow) => r.bookingReference },
    { header: "Court", value: (r: BookingReportRow) => r.courtName },
    { header: "Player", value: (r: BookingReportRow) => r.playerName },
    { header: "Type", value: (r: BookingReportRow) => r.type },
    { header: "Status", value: (r: BookingReportRow) => r.status },
    { header: "Start", value: (r: BookingReportRow) => r.startAt },
    { header: "End", value: (r: BookingReportRow) => r.endAt },
    { header: "Amount (cents)", value: (r: BookingReportRow) => r.totalAmountCents },
  ] satisfies CsvColumn<BookingReportRow>[],
  courtUtilization: [
    { header: "Court", value: (r: CourtUtilizationRow) => r.courtName },
    { header: "Bookings", value: (r: CourtUtilizationRow) => r.bookingsCount },
    { header: "Booked Hours", value: (r: CourtUtilizationRow) => r.bookedHours.toFixed(2) },
  ] satisfies CsvColumn<CourtUtilizationRow>[],
  // "openPlay" removed here (Phase 7 review) — see report.schema.ts's
  // comment. Open play revenue exports would belong at /dashboard/sales,
  // not this report switch.
  tournament: [
    { header: "Tournament", value: (r: TournamentReportRow) => r.name },
    { header: "Status", value: (r: TournamentReportRow) => r.status },
    { header: "Start Date", value: (r: TournamentReportRow) => r.startDate },
    { header: "End Date", value: (r: TournamentReportRow) => r.endDate },
    { header: "Registrations", value: (r: TournamentReportRow) => r.registrationsCount },
    { header: "Confirmed", value: (r: TournamentReportRow) => r.confirmedRegistrationsCount },
    { header: "Matches Played", value: (r: TournamentReportRow) => r.matchesPlayed },
    { header: "Fee Revenue (cents)", value: (r: TournamentReportRow) => r.feeRevenueCents },
  ] satisfies CsvColumn<TournamentReportRow>[],
  membership: [
    { header: "Membership Reference", value: (r: MembershipReportRow) => r.membershipReference },
    { header: "Player", value: (r: MembershipReportRow) => r.playerName },
    { header: "Plan", value: (r: MembershipReportRow) => r.planName },
    { header: "Status", value: (r: MembershipReportRow) => r.status },
    { header: "Start Date", value: (r: MembershipReportRow) => r.startDate },
    { header: "End Date", value: (r: MembershipReportRow) => r.endDate },
  ] satisfies CsvColumn<MembershipReportRow>[],
  coaching: [
    { header: "Session Reference", value: (r: CoachingReportRow) => r.sessionReference },
    { header: "Coach", value: (r: CoachingReportRow) => r.coachName },
    { header: "Player", value: (r: CoachingReportRow) => r.playerName },
    { header: "Booking Reference", value: (r: CoachingReportRow) => r.bookingReference },
    { header: "Court", value: (r: CoachingReportRow) => r.courtName },
    { header: "Status", value: (r: CoachingReportRow) => r.status },
    { header: "Start", value: (r: CoachingReportRow) => r.startAt },
    { header: "Fee (cents)", value: (r: CoachingReportRow) => r.rateCents },
  ] satisfies CsvColumn<CoachingReportRow>[],
  equipmentRental: [
    { header: "Rental Reference", value: (r: EquipmentRentalReportRow) => r.rentalReference },
    { header: "Equipment", value: (r: EquipmentRentalReportRow) => r.equipmentName },
    { header: "Player", value: (r: EquipmentRentalReportRow) => r.playerName },
    { header: "Status", value: (r: EquipmentRentalReportRow) => r.status },
    { header: "Rented At", value: (r: EquipmentRentalReportRow) => r.rentedAt },
    { header: "Due At", value: (r: EquipmentRentalReportRow) => r.dueAt },
    { header: "Returned At", value: (r: EquipmentRentalReportRow) => r.returnedAt },
    {
      header: "Billable Amount (cents)",
      value: (r: EquipmentRentalReportRow) => r.billableAmountCents,
    },
  ] satisfies CsvColumn<EquipmentRentalReportRow>[],
  lockerRental: [
    { header: "Rental Reference", value: (r: LockerRentalReportRow) => r.rentalReference },
    { header: "Locker", value: (r: LockerRentalReportRow) => r.lockerCode },
    { header: "Player", value: (r: LockerRentalReportRow) => r.playerName },
    { header: "Type", value: (r: LockerRentalReportRow) => r.type },
    { header: "Status", value: (r: LockerRentalReportRow) => r.status },
    { header: "Start", value: (r: LockerRentalReportRow) => r.startAt },
    { header: "End", value: (r: LockerRentalReportRow) => r.endAt },
    { header: "Amount (cents)", value: (r: LockerRentalReportRow) => r.amountCents },
  ] satisfies CsvColumn<LockerRentalReportRow>[],
  // One row per business day. Amounts stay in CENTS like every other
  // report here, so a spreadsheet can sum them without float error; the
  // header says so.
  //
  // Nulls export as an empty cell, NOT 0 — an unopened till must not read
  // as a balanced one. Excel shows blank, and a SUM over the column
  // ignores it rather than counting a day nobody reconciled.
  // Detailed expenses. Date and "Recorded at" are separate columns
  // because they are different facts: `date` is the day spent (date-only,
  // no time), `recordedAt` is when it was keyed in.
  //
  // Payment Method Key sits beside the label so a spreadsheet can filter
  // or pivot cash vs GCash on a stable value — labels are editable in
  // the CMS, keys are not.
  expenses: [
    { header: "Date", value: (r: ExpenseReportRow) => r.date.toISOString().slice(0, 10) },
    { header: "Recorded At", value: (r: ExpenseReportRow) => r.recordedAt.toISOString() },
    { header: "Expense #", value: (r: ExpenseReportRow) => r.expenseNumber },
    { header: "Description", value: (r: ExpenseReportRow) => r.description },
    { header: "Category", value: (r: ExpenseReportRow) => r.category },
    { header: "Payment Method", value: (r: ExpenseReportRow) => r.paymentMethodLabel },
    { header: "Payment Method Key", value: (r: ExpenseReportRow) => r.paymentMethodKey },
    // SPLIT COLUMNS, matching the on-screen table: the amount lands in
    // its own tender's column so a spreadsheet can SUM each one directly
    // instead of needing a filter or a SUMIF.
    //
    // A voided expense contributes 0 to both — its amount stays visible
    // in "Amount (cents)" below, so the reversal is still in the file
    // without being counted. That keeps a SUM of the Cash column equal
    // to the Cash total on screen.
    {
      header: "Cash (cents)",
      value: (r: ExpenseReportRow) =>
        !r.isVoided && r.paymentMethodKey === "CASH" ? r.amountCents : 0,
    },
    {
      header: "GCash (cents)",
      value: (r: ExpenseReportRow) =>
        !r.isVoided && r.paymentMethodKey === "GCASH" ? r.amountCents : 0,
    },
    {
      header: "Other (cents)",
      value: (r: ExpenseReportRow) =>
        !r.isVoided && r.paymentMethodKey !== "CASH" && r.paymentMethodKey !== "GCASH"
          ? r.amountCents
          : 0,
    },
    // The raw amount, voided or not — kept so a reversed row still shows
    // what it was for, which the split columns deliberately zero out.
    { header: "Amount (cents)", value: (r: ExpenseReportRow) => r.amountCents },
    { header: "Recorded By", value: (r: ExpenseReportRow) => r.recordedBy },
    { header: "Voided", value: (r: ExpenseReportRow) => (r.isVoided ? "YES" : "") },
    { header: "Void Reason", value: (r: ExpenseReportRow) => r.voidReason },
    { header: "Voided By", value: (r: ExpenseReportRow) => r.voidedBy },
    { header: "Receipt", value: (r: ExpenseReportRow) => (r.hasReceipt ? "yes" : "") },
  ] satisfies CsvColumn<ExpenseReportRow>[],
  // Itemized sales, split columns like expenses above: a voided sale
  // exports 0 in Cash/GCash but keeps its raw amount in "Amount (cents)".
  salesJournal: [
    { header: "Date", value: (r: SalesJournalRow) => (r.businessDate ? toDateValue(r.businessDate) : "") },
    { header: "Recorded At", value: (r: SalesJournalRow) => r.recordedAt.toISOString() },
    { header: "Sale #", value: (r: SalesJournalRow) => r.saleNumber },
    { header: "Type", value: (r: SalesJournalRow) => r.category },
    { header: "Item", value: (r: SalesJournalRow) => r.item },
    { header: "Payment Method", value: (r: SalesJournalRow) => r.paymentMethodLabel },
    {
      header: "Cash (cents)",
      value: (r: SalesJournalRow) => (!r.isVoided && r.paymentMethodKey === "CASH" ? r.amountCents : 0),
    },
    {
      header: "GCash (cents)",
      value: (r: SalesJournalRow) => (!r.isVoided && r.paymentMethodKey === "GCASH" ? r.amountCents : 0),
    },
    {
      header: "Other (cents)",
      value: (r: SalesJournalRow) =>
        !r.isVoided && r.paymentMethodKey !== "CASH" && r.paymentMethodKey !== "GCASH" ? r.amountCents : 0,
    },
    { header: "Amount (cents)", value: (r: SalesJournalRow) => r.amountCents },
    { header: "Staff", value: (r: SalesJournalRow) => r.staff },
    { header: "Shift", value: (r: SalesJournalRow) => r.shiftNumber },
    { header: "Source", value: (r: SalesJournalRow) => r.source },
    { header: "Voided", value: (r: SalesJournalRow) => (r.isVoided ? "YES" : "") },
    { header: "Void Reason", value: (r: SalesJournalRow) => r.voidReason },
    { header: "Payment Method Correction", value: (r: SalesJournalRow) => r.paymentMethodCorrectionReason },
  ] satisfies CsvColumn<SalesJournalRow>[],
  // Blank, not 0, wherever nothing was counted (open shift, closed without
  // a count, or no GCash check yet) — same rule as the sales report.
  shiftReconciliation: [
    { header: "Shift #", value: (r: ShiftReconciliationRow) => r.shiftNumber },
    { header: "Employee", value: (r: ShiftReconciliationRow) => r.employee },
    { header: "Status", value: (r: ShiftReconciliationRow) => r.status },
    { header: "Started At", value: (r: ShiftReconciliationRow) => r.startedAt.toISOString() },
    { header: "Ended At", value: (r: ShiftReconciliationRow) => r.endedAt?.toISOString() ?? "" },
    { header: "Opening Cash (cents)", value: (r: ShiftReconciliationRow) => r.openingCashCents },
    { header: "Expected Cash (cents)", value: (r: ShiftReconciliationRow) => r.expectedCashCents },
    { header: "Counted Cash (cents)", value: (r: ShiftReconciliationRow) => r.countedCashCents },
    { header: "Cash Variance (cents)", value: (r: ShiftReconciliationRow) => r.cashVarianceCents },
    { header: "Opening GCash (cents)", value: (r: ShiftReconciliationRow) => r.openingGcashCents },
    { header: "Expected GCash (cents)", value: (r: ShiftReconciliationRow) => r.expectedGcashCents },
    { header: "GCash In App (cents)", value: (r: ShiftReconciliationRow) => r.closingGcashCents },
    { header: "GCash Variance (cents)", value: (r: ShiftReconciliationRow) => r.gcashVarianceCents },
    { header: "Closed Without Count", value: (r: ShiftReconciliationRow) => (r.closedWithoutCount ? "YES" : "") },
    { header: "Closing Note", value: (r: ShiftReconciliationRow) => r.closingNotes },
  ] satisfies CsvColumn<ShiftReconciliationRow>[],
  dailyReconciliation: [
    { header: "Date", value: (r: DailyReconciliationRow) => toDateValue(r.date) },
    { header: "Transactions", value: (r: DailyReconciliationRow) => r.transactionCount },
    { header: "Total Sales (cents)", value: (r: DailyReconciliationRow) => r.totalSalesCents },
    { header: "Cash Sales (cents)", value: (r: DailyReconciliationRow) => r.cashSalesCents },
    { header: "GCash Sales (cents)", value: (r: DailyReconciliationRow) => r.gcashSalesCents },
    { header: "Other Sales (cents)", value: (r: DailyReconciliationRow) => r.otherSalesCents },
    { header: "Cash Expenses (cents)", value: (r: DailyReconciliationRow) => r.cashExpensesCents },
    {
      header: "GCash Expenses (cents)",
      value: (r: DailyReconciliationRow) => r.gcashExpensesCents,
    },
    {
      header: "Other Expenses (cents)",
      value: (r: DailyReconciliationRow) => r.otherExpensesCents,
    },
    {
      header: "Total Expenses (cents)",
      value: (r: DailyReconciliationRow) => r.totalExpensesCents,
    },
    { header: "Cash Starting (cents)", value: (r: DailyReconciliationRow) => r.cashStartingCents },
    { header: "Cash Expected (cents)", value: (r: DailyReconciliationRow) => r.cashExpectedCents },
    { header: "Cash Counted (cents)", value: (r: DailyReconciliationRow) => r.cashCountedCents },
    {
      header: "Cash Deposited (cents)",
      value: (r: DailyReconciliationRow) => r.cashDepositedCents,
    },
    { header: "Cash Variance (cents)", value: (r: DailyReconciliationRow) => r.cashVarianceCents },
    { header: "Cash Status", value: (r: DailyReconciliationRow) => r.cashStatus },
    { header: "GCash Starting (cents)", value: (r: DailyReconciliationRow) => r.gcashStartingCents },
    { header: "GCash Expected (cents)", value: (r: DailyReconciliationRow) => r.gcashExpectedCents },
    { header: "GCash Counted (cents)", value: (r: DailyReconciliationRow) => r.gcashCountedCents },
    { header: "GCash Variance (cents)", value: (r: DailyReconciliationRow) => r.gcashVarianceCents },
    { header: "GCash Status", value: (r: DailyReconciliationRow) => r.gcashStatus },
    {
      header: "Total Variance (cents)",
      value: (r: DailyReconciliationRow) => r.totalVarianceCents,
    },
  ] satisfies CsvColumn<DailyReconciliationRow>[],
  salesByCategory: [
    { header: "Category", value: (r: SalesByCategoryRow) => r.category },
    { header: "Transactions", value: (r: SalesByCategoryRow) => r.transactionCount },
    { header: "Amount (cents)", value: (r: SalesByCategoryRow) => r.amountCents },
  ] satisfies CsvColumn<SalesByCategoryRow>[],
  salesByPaymentMethod: [
    { header: "Payment Method", value: (r: SalesByPaymentMethodRow) => r.paymentMethodLabel },
    { header: "Transactions", value: (r: SalesByPaymentMethodRow) => r.transactionCount },
    { header: "Amount (cents)", value: (r: SalesByPaymentMethodRow) => r.amountCents },
  ] satisfies CsvColumn<SalesByPaymentMethodRow>[],
  salesByProduct: [
    { header: "Product", value: (r: SalesByProductRow) => r.productName },
    { header: "Qty Sold", value: (r: SalesByProductRow) => r.quantitySold },
    { header: "Transactions", value: (r: SalesByProductRow) => r.transactionCount },
    { header: "Amount (cents)", value: (r: SalesByProductRow) => r.amountCents },
  ] satisfies CsvColumn<SalesByProductRow>[],
} as const;

export type ReportType = keyof typeof REPORT_CSV_COLUMNS;
