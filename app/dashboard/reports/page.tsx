import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { DateRangePicker } from "@/features/analytics/components/date-range-picker";
import { formatCurrency } from "@/lib/utils";
import { resolveDateRangeFromSearchParams } from "@/services/analytics/date-range";
import { expenseService } from "@/services/expenses/expense.service";
import { reportingService } from "@/services/reporting/reporting.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Reports",
};

// Open play revenue lives at /dashboard/sales, not here — see
// features/reports/schemas/report.schema.ts's comment on why "openPlay"
// was removed from this list rather than repaired.
const REPORT_LINKS: { reportType: string; title: string; description: string }[] = [
  {
    reportType: "booking",
    title: "Booking report",
    description: "All bookings in the selected range.",
  },
  {
    reportType: "courtUtilization",
    title: "Court utilization",
    description: "Booked hours and booking counts per court.",
  },
  {
    reportType: "coaching",
    title: "Coaching report",
    description: "Coaching sessions, coaches, and fees in range.",
  },
  {
    reportType: "dailyReconciliation",
    title: "Daily sales & reconciliation",
    description:
      "One row per day: sales split by tender, plus each till's starting, expected, counted and variance. Export 30 days for a month-end sheet.",
  },
  {
    reportType: "salesByProduct",
    title: "Sales by product",
    description: "Per-product breakdown (shirts, grips, etc.) for consignment accounting.",
  },
  {
    reportType: "equipmentRental",
    title: "Equipment rentals",
    description: "Equipment rental transactions in range.",
  },
  {
    reportType: "membership",
    title: "Membership report",
    description: "Memberships, enrollments, and renewals.",
  },
  {
    reportType: "salesByCategory",
    title: "Sales by category",
    description: "Sale transactions grouped by category (Sale-sourced, not module amounts).",
  },
  {
    reportType: "salesByPaymentMethod",
    title: "Sales by payment method",
    description: "Sale transactions grouped by how they were paid.",
  },
  {
    reportType: "tournament",
    title: "Tournament report",
    description: "Tournaments, registrations, and matches.",
  },
];

interface ReportsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const [params, courtHours] = await Promise.all([searchParams, settingsService.getCourtHours()]);
  const range = resolveDateRangeFromSearchParams(params, courtHours.businessDateRolloverHour);
  const [revenue, totalExpensesCents, cashPosition] = await Promise.all([
    reportingService.getRevenueReport(range, courtHours.businessDateRolloverHour),
    expenseService.getExpensesTotalForRange(range),
    reportingService.getCashPositionSummary(range),
  ]);
  const netCents = revenue.totalAmountCents - totalExpensesCents;

  const queryString = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value] as [string, string]] : [],
    ),
  ).toString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-muted-foreground text-sm">
            Operational reports across every module, exportable to CSV.
          </p>
        </div>
        <DateRangePicker />
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Booking</span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(revenue.bookingAmountCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Shop products</span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(revenue.productAmountCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Coaching</span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(revenue.coachingAmountCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Regular open play</span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(revenue.regularOpenPlayAmountCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Unli play</span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(revenue.unliOpenPlayAmountCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Total sales</span>
            <span className="text-lg font-semibold tabular-nums">
              {formatCurrency(revenue.totalAmountCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1 border-t pt-3">
            <span className="text-muted-foreground text-xs">Cash collected</span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(revenue.cashAmountCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1 border-t pt-3">
            <span className="text-muted-foreground text-xs">GCash collected</span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(revenue.gcashAmountCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1 border-t pt-3">
            <span className="text-muted-foreground text-xs">Cash starting balance</span>
            <span className="font-semibold tabular-nums">
              {cashPosition.cashStartingBalanceCents === null
                ? "—"
                : formatCurrency(cashPosition.cashStartingBalanceCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1 border-t pt-3">
            <span className="text-muted-foreground text-xs">Cash deposited</span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(cashPosition.cashDepositedCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1 border-t pt-3">
            <span className="text-muted-foreground text-xs">GCash starting balance</span>
            <span className="font-semibold tabular-nums">
              {cashPosition.gcashStartingBalanceCents === null
                ? "—"
                : formatCurrency(cashPosition.gcashStartingBalanceCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1 border-t pt-3 sm:col-span-2">
            <span className="text-muted-foreground text-xs">Total expenses</span>
            <span className="text-destructive text-lg font-semibold tabular-nums">
              {formatCurrency(totalExpensesCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1 border-t pt-3 sm:col-span-2">
            <span className="text-muted-foreground text-xs">Net</span>
            <span
              className={`text-lg font-semibold tabular-nums ${netCents < 0 ? "text-destructive" : "text-success"}`}
            >
              {formatCurrency(netCents)}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_LINKS.map((report) => (
          <Link
            key={report.reportType}
            href={`/dashboard/reports/${report.reportType}${queryString ? `?${queryString}` : ""}`}
            className="hover:border-primary/50 hover:bg-muted/30 flex flex-col gap-2 rounded-xl border p-4 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FileText className="text-muted-foreground size-4" aria-hidden="true" />
              <span className="font-medium">{report.title}</span>
            </div>
            <p className="text-muted-foreground text-sm">{report.description}</p>
          </Link>
        ))}
        {/* Owner request (2026-08-12): "kindly build history also of
            player tabs. daily so we will know all the details" — a real
            standalone page (services/open-play/player-tab-history.
            service.ts), not routed through the generic [reportType]
            switch above — see report.schema.ts's own comment on why
            open-play data was deliberately pulled OUT of that switch. */}
        <Link
          href={`/dashboard/reports/player-tabs${queryString ? `?${queryString}` : ""}`}
          className="hover:border-primary/50 hover:bg-muted/30 flex flex-col gap-2 rounded-xl border p-4 transition-colors"
        >
          <div className="flex items-center gap-2">
            <FileText className="text-muted-foreground size-4" aria-hidden="true" />
            <span className="font-medium">Player tabs history</span>
          </div>
          <p className="text-muted-foreground text-sm">
            Every Open Play tab in range — settled, written off, or still open.
          </p>
        </Link>
      </div>
    </div>
  );
}
