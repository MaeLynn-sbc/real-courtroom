import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { DateRangePicker } from "@/features/analytics/components/date-range-picker";
import { BookingStatusBadge } from "@/features/bookings/components/booking-status-badge";
import { EquipmentRentalStatusBadge } from "@/features/equipment/components/equipment-rental-status-badge";
import { LockerRentalStatusBadge } from "@/features/lockers/components/locker-rental-status-badge";
import { MembershipStatusBadge } from "@/features/memberships/components/membership-status-badge";
import { CoachingWeeklyReport } from "@/features/reports/components/coaching-weekly-report";
import { ExportButtons } from "@/features/reports/components/export-buttons";
import { ReportTable, type ReportTableColumn } from "@/features/reports/components/report-table";
import {
  dateRangeSchema,
  reportTypeSchema,
  type DateRangeInput,
  type ReportTypeInput,
} from "@/features/reports/schemas/report.schema";
import { TournamentStatusBadge } from "@/features/tournaments/components/tournament-status-badge";
import type {
  BookingStatus,
  LockerRentalStatus,
  MembershipStatus,
  RentalStatus,
  TournamentStatus,
} from "@/lib/generated/prisma/enums";
import { toDateValue } from "@/lib/date-value";
import { paymentMethodStyle } from "@/lib/payment-method-style";
import { formatCurrency, varianceTextClass } from "@/lib/utils";
import { resolveDateRangeFromSearchParams, type DateRange } from "@/services/analytics/date-range";
import { expenseService, type ExpenseReportRow } from "@/services/expenses/expense.service";
import { settingsService } from "@/services/settings/settings.service";
import {
  reportingService,
  type BookingReportRow,
  type CourtUtilizationRow,
  type EquipmentRentalReportRow,
  type LockerRentalReportRow,
  type MembershipReportRow,
  type DailyReconciliationRow,
  type SalesByCategoryRow,
  type SalesByPaymentMethodRow,
  type SalesByProductRow,
  type TournamentReportRow,
} from "@/services/reporting/reporting.service";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });
// Manila-pinned, like every other staff-facing time in the app — never
// the server's ambient zone.
const timeFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const REPORT_TITLES: Record<string, string> = {
  booking: "Booking report",
  courtUtilization: "Court utilization report",
  tournament: "Tournament report",
  membership: "Membership report",
  coaching: "Coaching report",
  equipmentRental: "Equipment rental report",
  lockerRental: "Locker rental report",
  salesByCategory: "Sales by category",
  salesByPaymentMethod: "Sales by payment method",
  salesByProduct: "Sales by product",
  dailyReconciliation: "Sales report",
};

interface ReportPageProps {
  params: Promise<{ reportType: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ReportPageProps): Promise<Metadata> {
  const { reportType } = await params;
  return { title: REPORT_TITLES[reportType] ?? "Report" };
}

export default async function ReportPage({ params, searchParams }: ReportPageProps) {
  const [{ reportType }, rawSearchParams] = await Promise.all([params, searchParams]);
  const parsedType = reportTypeSchema.safeParse(reportType);
  if (!parsedType.success) {
    notFound();
  }

  // Coaching gets its own weekly-tabs/per-coach/archive layout, not the
  // generic DateRangePicker + single-table chrome every other report
  // type below shares — see that component's own comment.
  if (parsedType.data === "coaching") {
    return <CoachingWeeklyReport searchParams={rawSearchParams} />;
  }

  const courtHours = await settingsService.getCourtHours();
  const range = resolveDateRangeFromSearchParams(rawSearchParams, courtHours.businessDateRolloverHour);
  const parsedRangeInput = dateRangeSchema.safeParse({
    preset: rawSearchParams.preset,
    from: rawSearchParams.from,
    to: rawSearchParams.to,
    month: rawSearchParams.month,
  });
  const rangeInput: DateRangeInput = parsedRangeInput.success
    ? parsedRangeInput.data
    : { preset: "30_DAYS" };

  const table = await renderTable(parsedType.data, range, courtHours.businessDateRolloverHour);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {REPORT_TITLES[parsedType.data]}
          </h1>
          <p className="text-muted-foreground text-sm">
            {range.from.toLocaleDateString()} – {range.to.toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <DateRangePicker />
          <ExportButtons input={{ reportType: parsedType.data, range: rangeInput }} />
        </div>
      </div>

      {table}
    </div>
  );
}

async function renderTable(reportType: ReportTypeInput, range: DateRange, rolloverHour: number) {
  switch (reportType) {
    case "booking": {
      const { rows } = await reportingService.getBookingReport(range);
      const columns: ReportTableColumn<BookingReportRow>[] = [
        { header: "Reference", render: (r) => r.bookingReference },
        { header: "Court", render: (r) => r.courtName },
        { header: "Player", render: (r) => r.playerName ?? "—" },
        { header: "Type", render: (r) => r.type },
        {
          header: "Status",
          render: (r) => <BookingStatusBadge status={r.status as BookingStatus} />,
        },
        { header: "Start", render: (r) => dateFormatter.format(r.startAt) },
        { header: "Amount", render: (r) => formatCurrency(r.totalAmountCents) },
      ];
      return <ReportTable rows={rows} columns={columns} getRowKey={(r) => r.id} />;
    }
    case "courtUtilization": {
      const rows = await reportingService.getCourtUtilizationReport(range);
      const columns: ReportTableColumn<CourtUtilizationRow>[] = [
        { header: "Court", render: (r) => r.courtName },
        { header: "Bookings", render: (r) => r.bookingsCount },
        { header: "Booked hours", render: (r) => r.bookedHours.toFixed(1) },
      ];
      return <ReportTable rows={rows} columns={columns} getRowKey={(r) => r.courtId} />;
    }
    case "tournament": {
      const rows = await reportingService.getTournamentReport(range);
      const columns: ReportTableColumn<TournamentReportRow>[] = [
        { header: "Tournament", render: (r) => r.name },
        {
          header: "Status",
          render: (r) => <TournamentStatusBadge status={r.status as TournamentStatus} />,
        },
        { header: "Start", render: (r) => dateFormatter.format(r.startDate) },
        { header: "Registrations", render: (r) => r.registrationsCount },
        { header: "Confirmed", render: (r) => r.confirmedRegistrationsCount },
        { header: "Matches", render: (r) => r.matchesPlayed },
        { header: "Fee revenue", render: (r) => formatCurrency(r.feeRevenueCents) },
      ];
      return <ReportTable rows={rows} columns={columns} getRowKey={(r) => r.id} />;
    }
    case "membership": {
      const { rows } = await reportingService.getMembershipReport(range);
      const columns: ReportTableColumn<MembershipReportRow>[] = [
        { header: "Reference", render: (r) => r.membershipReference },
        { header: "Player", render: (r) => r.playerName },
        { header: "Plan", render: (r) => r.planName },
        {
          header: "Status",
          render: (r) => <MembershipStatusBadge status={r.status as MembershipStatus} />,
        },
        { header: "Start", render: (r) => dateFormatter.format(r.startDate) },
        { header: "End", render: (r) => dateFormatter.format(r.endDate) },
      ];
      return <ReportTable rows={rows} columns={columns} getRowKey={(r) => r.id} />;
    }
    case "equipmentRental": {
      const rows = await reportingService.getEquipmentRentalReport(range);
      const columns: ReportTableColumn<EquipmentRentalReportRow>[] = [
        { header: "Reference", render: (r) => r.rentalReference },
        { header: "Equipment", render: (r) => r.equipmentName },
        { header: "Player", render: (r) => r.playerName },
        {
          header: "Status",
          render: (r) => <EquipmentRentalStatusBadge status={r.status as RentalStatus} />,
        },
        { header: "Rented at", render: (r) => dateFormatter.format(r.rentedAt) },
        { header: "Amount", render: (r) => formatCurrency(r.billableAmountCents) },
      ];
      return <ReportTable rows={rows} columns={columns} getRowKey={(r) => r.id} />;
    }
    case "lockerRental": {
      const rows = await reportingService.getLockerRentalReport(range);
      const columns: ReportTableColumn<LockerRentalReportRow>[] = [
        { header: "Reference", render: (r) => r.rentalReference },
        { header: "Locker", render: (r) => r.lockerCode },
        { header: "Player", render: (r) => r.playerName },
        { header: "Type", render: (r) => r.type },
        {
          header: "Status",
          render: (r) => <LockerRentalStatusBadge status={r.status as LockerRentalStatus} />,
        },
        { header: "Start", render: (r) => dateFormatter.format(r.startAt) },
        { header: "Amount", render: (r) => formatCurrency(r.amountCents) },
      ];
      return <ReportTable rows={rows} columns={columns} getRowKey={(r) => r.id} />;
    }
    case "salesByCategory": {
      const rows = await reportingService.getSalesByCategoryReport(range, rolloverHour);
      const columns: ReportTableColumn<SalesByCategoryRow>[] = [
        {
          header: "Category",
          // Reported live: manual sales (SaleCategory.OTHER — an
          // arbitrary amount with no linked booking/membership/etc. row,
          // recorded for revenue outside every modelled flow) must be
          // visibly distinguishable here, not blended in with modelled
          // revenue — a month with many of these is itself a signal
          // something isn't being captured properly.
          render: (r) =>
            r.category === "OTHER" ? <Badge variant="warning">Manual entry</Badge> : r.category,
        },
        { header: "Transactions", render: (r) => r.transactionCount },
        { header: "Amount", render: (r) => formatCurrency(r.amountCents) },
      ];
      return <ReportTable rows={rows} columns={columns} getRowKey={(r) => r.category} />;
    }
    case "salesByPaymentMethod": {
      const rows = await reportingService.getSalesByPaymentMethodReport(range, rolloverHour);
      const columns: ReportTableColumn<SalesByPaymentMethodRow>[] = [
        { header: "Payment Method", render: (r) => r.paymentMethodLabel },
        { header: "Transactions", render: (r) => r.transactionCount },
        { header: "Amount", render: (r) => formatCurrency(r.amountCents) },
      ];
      return <ReportTable rows={rows} columns={columns} getRowKey={(r) => r.paymentMethodLabel} />;
    }
    case "expenses": {
      const rows = await expenseService.getExpensesReport(range);
      // SEPARATE COLUMNS PER TENDER (owner request, 2026-09-22), not one
      // Amount column with a method badge. Scanning down a single column
      // to total the cash is what this report is used for; a mixed column
      // makes that a manual filter every time.
      //
      // A voided expense contributes NOTHING to either column — its
      // amount is struck through in place so the reversal stays visible
      // without polluting the total beneath it.
      const cashOf = (r: ExpenseReportRow) =>
        !r.isVoided && r.paymentMethodKey === "CASH" ? r.amountCents : 0;
      const gcashOf = (r: ExpenseReportRow) =>
        !r.isVoided && r.paymentMethodKey === "GCASH" ? r.amountCents : 0;
      const otherOf = (r: ExpenseReportRow) =>
        !r.isVoided && r.paymentMethodKey !== "CASH" && r.paymentMethodKey !== "GCASH"
          ? r.amountCents
          : 0;
      const sum = (pick: (r: ExpenseReportRow) => number) =>
        rows.reduce((total, r) => total + pick(r), 0);

      const cashTotal = sum(cashOf);
      const gcashTotal = sum(gcashOf);
      const otherTotal = sum(otherOf);
      // Only shown when something actually used a third method — an empty
      // column on every row is noise.
      const hasOther = otherTotal > 0;

      // Amount in its own tender's column, struck through if voided, and
      // a plain dash where that row used the other tender — so a blank
      // reads as "not this one" rather than "missing".
      const amountCell = (r: ExpenseReportRow, belongs: boolean) => {
        if (!belongs) {
          return <span className="text-muted-foreground/40">—</span>;
        }
        return r.isVoided ? (
          <span className="text-muted-foreground line-through">{formatCurrency(r.amountCents)}</span>
        ) : (
          formatCurrency(r.amountCents)
        );
      };

      const columns: ReportTableColumn<ExpenseReportRow>[] = [
        { header: "Date", render: (r) => toDateValue(r.date) },
        { header: "Recorded", render: (r) => timeFormatter.format(r.recordedAt) },
        { header: "Description", render: (r) => r.description },
        { header: "Category", render: (r) => r.category },
        {
          header: "Cash",
          render: (r) => amountCell(r, r.paymentMethodKey === "CASH"),
        },
        {
          header: "GCash",
          render: (r) => amountCell(r, r.paymentMethodKey === "GCASH"),
        },
        ...(hasOther
          ? [
              {
                header: "Other",
                render: (r: ExpenseReportRow) =>
                  amountCell(r, r.paymentMethodKey !== "CASH" && r.paymentMethodKey !== "GCASH"),
              },
            ]
          : []),
        { header: "Recorded by", render: (r) => r.recordedBy },
        {
          header: "Status",
          render: (r) =>
            r.isVoided ? (
              <span className="text-destructive text-xs">
                Voided{r.voidReason ? `: ${r.voidReason}` : ""}
              </span>
            ) : (
              ""
            ),
        },
      ];

      return (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className={`rounded-md border px-3 py-1.5 ${paymentMethodStyle("CASH").badge}`}>
              Cash: <span className="font-bold">{formatCurrency(cashTotal)}</span>
            </span>
            <span className={`rounded-md border px-3 py-1.5 ${paymentMethodStyle("GCASH").badge}`}>
              GCash: <span className="font-bold">{formatCurrency(gcashTotal)}</span>
            </span>
            {hasOther ? (
              <span className="rounded-md border px-3 py-1.5">
                Other: <span className="font-bold">{formatCurrency(otherTotal)}</span>
              </span>
            ) : null}
            <span className="rounded-md border px-3 py-1.5">
              Total:{" "}
              <span className="font-bold">
                {formatCurrency(cashTotal + gcashTotal + otherTotal)}
              </span>
            </span>
          </div>
          <ReportTable
            rows={rows}
            columns={columns}
            getRowKey={(r) => r.expenseNumber}
            // Totals under their own columns, so the figure sits directly
            // beneath the numbers it adds up.
            renderFooter={() => [
              "Total",
              "",
              "",
              "",
              <span key="cash" className="font-bold">
                {formatCurrency(cashTotal)}
              </span>,
              <span key="gcash" className="font-bold">
                {formatCurrency(gcashTotal)}
              </span>,
              ...(hasOther
                ? [
                    <span key="other" className="font-bold">
                      {formatCurrency(otherTotal)}
                    </span>,
                  ]
                : []),
              "",
              "",
            ]}
          />
        </div>
      );
    }
    case "dailyReconciliation": {
      const rows = await reportingService.getDailyReconciliationReport(range, rolloverHour);
      // A dash, not PHP 0.00, when no balance row exists — an unopened
      // till must not read as a balanced one. Same rule the CSV follows
      // with an empty cell.
      const money = (cents: number | null) => (cents === null ? "—" : formatCurrency(cents));
      // Variance is the column people scan for, so it is signed and
      // coloured by the owner's own convention (2026-09-18): over green,
      // short red. Same varianceTextClass the reconciliation screens use.
      const variance = (cents: number | null) =>
        cents === null ? (
          "—"
        ) : cents === 0 ? (
          formatCurrency(0)
        ) : (
          <span className={`font-medium ${varianceTextClass(cents)}`}>
            {cents > 0 ? "+" : ""}
            {formatCurrency(cents)}
          </span>
        );
      const sum = (pick: (r: DailyReconciliationRow) => number) =>
        rows.reduce((total, row) => total + pick(row), 0);
      // A month total of the variances only counts the days that were
      // actually confirmed — summing nulls as zero would read as "these
      // days balanced". Null when no day in the range was confirmed.
      const sumVariance = (pick: (r: DailyReconciliationRow) => number | null) => {
        const known = rows.map(pick).filter((cents): cents is number => cents !== null);
        return known.length === 0 ? null : known.reduce((total, cents) => total + cents, 0);
      };
      const columns: ReportTableColumn<DailyReconciliationRow>[] = [
        { header: "Date", render: (r) => toDateValue(r.date) },
        { header: "Txns", render: (r) => r.transactionCount },
        { header: "Total sales", render: (r) => formatCurrency(r.totalSalesCents) },
        { header: "Cash sales", render: (r) => formatCurrency(r.cashSalesCents) },
        { header: "GCash sales", render: (r) => formatCurrency(r.gcashSalesCents) },
        { header: "Cash exp.", render: (r) => formatCurrency(r.cashExpensesCents) },
        { header: "GCash exp.", render: (r) => formatCurrency(r.gcashExpensesCents) },
        { header: "Total exp.", render: (r) => formatCurrency(r.totalExpensesCents) },
        { header: "Cash expected", render: (r) => money(r.cashExpectedCents) },
        { header: "Cash counted", render: (r) => money(r.cashCountedCents) },
        { header: "Deposited", render: (r) => money(r.cashDepositedCents) },
        { header: "Cash var.", render: (r) => variance(r.cashVarianceCents) },
        { header: "GCash expected", render: (r) => money(r.gcashExpectedCents) },
        { header: "GCash counted", render: (r) => money(r.gcashCountedCents) },
        { header: "GCash var.", render: (r) => variance(r.gcashVarianceCents) },
        { header: "Total var.", render: (r) => variance(r.totalVarianceCents) },
      ];
      return (
        <ReportTable
          rows={rows}
          columns={columns}
          getRowKey={(r) => r.date.toISOString()}
          // Month totals, in the same column order. Expected/counted
          // balances are deliberately blank: they are running floats that
          // carry night to night, so adding them down a month would
          // count the same money over and over.
          renderFooter={(monthRows) => [
            `${monthRows.length} ${monthRows.length === 1 ? "day" : "days"}`,
            sum((r) => r.transactionCount),
            formatCurrency(sum((r) => r.totalSalesCents)),
            formatCurrency(sum((r) => r.cashSalesCents)),
            formatCurrency(sum((r) => r.gcashSalesCents)),
            formatCurrency(sum((r) => r.cashExpensesCents)),
            formatCurrency(sum((r) => r.gcashExpensesCents)),
            formatCurrency(sum((r) => r.totalExpensesCents)),
            null,
            null,
            formatCurrency(sum((r) => r.cashDepositedCents ?? 0)),
            variance(sumVariance((r) => r.cashVarianceCents)),
            null,
            null,
            variance(sumVariance((r) => r.gcashVarianceCents)),
            variance(sumVariance((r) => r.totalVarianceCents)),
          ]}
        />
      );
    }
    case "salesByProduct": {
      const rows = await reportingService.getSalesByProductReport(range, rolloverHour);
      const columns: ReportTableColumn<SalesByProductRow>[] = [
        { header: "Product", render: (r) => r.productName },
        { header: "Qty sold", render: (r) => r.quantitySold },
        { header: "Transactions", render: (r) => r.transactionCount },
        { header: "Amount", render: (r) => formatCurrency(r.amountCents) },
      ];
      return <ReportTable rows={rows} columns={columns} getRowKey={(r) => r.productName} />;
    }
  }
}
