import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { DateRangePicker } from "@/features/analytics/components/date-range-picker";
import { formatCurrency } from "@/lib/utils";
import { resolveDateRangeFromSearchParams } from "@/services/analytics/date-range";
import { expenseService } from "@/services/expenses/expense.service";
import { reportingService } from "@/services/reporting/reporting.service";

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
    reportType: "tournament",
    title: "Tournament report",
    description: "Tournaments, registrations, and matches.",
  },
  {
    reportType: "membership",
    title: "Membership report",
    description: "Memberships, enrollments, and renewals.",
  },
  {
    reportType: "equipmentRental",
    title: "Equipment rentals",
    description: "Equipment rental transactions in range.",
  },
  {
    reportType: "lockerRental",
    title: "Locker rentals",
    description: "Locker rental transactions in range.",
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
    reportType: "salesByProduct",
    title: "Sales by product",
    description: "Per-product breakdown (shirts, grips, etc.) for consignment accounting.",
  },
];

interface ReportsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const range = resolveDateRangeFromSearchParams(params);
  const [revenue, totalExpensesCents] = await Promise.all([
    reportingService.getRevenueReport(range),
    expenseService.getExpensesTotalForRange(range),
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
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
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
            <span className="text-muted-foreground text-xs">Open play</span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(revenue.openPlayAmountCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Total sales</span>
            <span className="text-lg font-semibold tabular-nums">
              {formatCurrency(revenue.totalAmountCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Total expenses</span>
            <span className="text-destructive text-lg font-semibold tabular-nums">
              {formatCurrency(totalExpensesCents)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
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
      </div>
    </div>
  );
}
