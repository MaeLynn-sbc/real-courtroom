import type {
  BookingReportRow,
  CourtUtilizationRow,
  EquipmentRentalReportRow,
  LockerRentalReportRow,
  MembershipReportRow,
  SalesByCategoryRow,
  SalesByPaymentMethodRow,
  TournamentReportRow,
} from "@/services/reporting/reporting.service";

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
  equipmentRental: [
    { header: "Rental Reference", value: (r: EquipmentRentalReportRow) => r.rentalReference },
    { header: "Equipment", value: (r: EquipmentRentalReportRow) => r.equipmentName },
    { header: "Player", value: (r: EquipmentRentalReportRow) => r.playerName },
    { header: "Status", value: (r: EquipmentRentalReportRow) => r.status },
    { header: "Rented At", value: (r: EquipmentRentalReportRow) => r.rentedAt },
    { header: "Due At", value: (r: EquipmentRentalReportRow) => r.dueAt },
    { header: "Returned At", value: (r: EquipmentRentalReportRow) => r.returnedAt },
    { header: "Billable Amount (cents)", value: (r: EquipmentRentalReportRow) => r.billableAmountCents },
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
} as const;

export type ReportType = keyof typeof REPORT_CSV_COLUMNS;
