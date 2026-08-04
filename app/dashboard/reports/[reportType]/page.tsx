import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { DateRangePicker } from "@/features/analytics/components/date-range-picker";
import { BookingStatusBadge } from "@/features/bookings/components/booking-status-badge";
import { EquipmentRentalStatusBadge } from "@/features/equipment/components/equipment-rental-status-badge";
import { LockerRentalStatusBadge } from "@/features/lockers/components/locker-rental-status-badge";
import { MembershipStatusBadge } from "@/features/memberships/components/membership-status-badge";
import { CoachingWeeklyReport } from "@/features/reports/components/coaching-weekly-report";
import { ExportCsvButton } from "@/features/reports/components/export-csv-button";
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
import { formatCurrency } from "@/lib/utils";
import { resolveDateRangeFromSearchParams, type DateRange } from "@/services/analytics/date-range";
import {
  reportingService,
  type BookingReportRow,
  type CourtUtilizationRow,
  type EquipmentRentalReportRow,
  type LockerRentalReportRow,
  type MembershipReportRow,
  type SalesByCategoryRow,
  type SalesByPaymentMethodRow,
  type SalesByProductRow,
  type TournamentReportRow,
} from "@/services/reporting/reporting.service";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });
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

  const range = resolveDateRangeFromSearchParams(rawSearchParams);
  const parsedRangeInput = dateRangeSchema.safeParse({
    preset: rawSearchParams.preset,
    from: rawSearchParams.from,
    to: rawSearchParams.to,
  });
  const rangeInput: DateRangeInput = parsedRangeInput.success
    ? parsedRangeInput.data
    : { preset: "30_DAYS" };

  const table = await renderTable(parsedType.data, range);

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
        <div className="flex flex-wrap items-end gap-3">
          <DateRangePicker />
          <ExportCsvButton input={{ reportType: parsedType.data, range: rangeInput }} />
        </div>
      </div>

      {table}
    </div>
  );
}

async function renderTable(reportType: ReportTypeInput, range: DateRange) {
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
      const rows = await reportingService.getSalesByCategoryReport(range);
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
      const rows = await reportingService.getSalesByPaymentMethodReport(range);
      const columns: ReportTableColumn<SalesByPaymentMethodRow>[] = [
        { header: "Payment Method", render: (r) => r.paymentMethodLabel },
        { header: "Transactions", render: (r) => r.transactionCount },
        { header: "Amount", render: (r) => formatCurrency(r.amountCents) },
      ];
      return <ReportTable rows={rows} columns={columns} getRowKey={(r) => r.paymentMethodLabel} />;
    }
    case "salesByProduct": {
      const rows = await reportingService.getSalesByProductReport(range);
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
