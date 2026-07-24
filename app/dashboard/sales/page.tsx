import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/features/analytics/components/date-range-picker";
import { formatCurrency } from "@/lib/utils";
import { resolveDateRangeFromSearchParams } from "@/services/analytics/date-range";
import { openPlaySalesService } from "@/services/open-play/open-play-sales.service";

export const metadata: Metadata = {
  title: "Sales — Open Play",
};

export const dynamic = "force-dynamic";

// BUILD-SPEC.md §9 "/dashboard/sales." A dedicated, open-play-focused
// summary rather than a new entry in the generic /dashboard/reports
// switch — that system's existing "openPlay" report reads from the old,
// dormant OpenPlaySession (a pre-existing gap, not something this page
// tries to fix), and §9's breakdown (games/rentals/adjustments/write-offs,
// by payment method, reconciliation) doesn't fit that report's shape
// anyway. "Court bookings — subtotal per court" from §9's breakdown is
// intentionally NOT duplicated here — that's the existing
// courtUtilization/booking reports' job; this page is open play revenue
// specifically, matching what Phase 7 actually built (tabs/settlement).

interface SalesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SalesPage({ searchParams }: SalesPageProps) {
  const params = await searchParams;
  const range = resolveDateRangeFromSearchParams(params);
  const summary = await openPlaySalesService.getSummary(range.from, range.to);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Open Play Sales</h1>
          <p className="text-muted-foreground text-sm">
            Games, equipment rentals, and adjustments settled through player tabs.
          </p>
        </div>
        <DateRangePicker />
      </div>

      {/* BUILD-SPEC.md §9 review: not a footnote — Fri/Sat ₱150 registration
          fees are real cash being collected right now (§8's walk-in cash
          path) and are entirely excluded from every number on this page.
          Delete this banner as part of Phase 8, once that revenue is
          actually tracked here — not before. */}
      <div className="border-coral/40 bg-coral/[0.08] text-coral flex items-start gap-2 rounded-lg border px-4 py-3 text-sm font-medium">
        <span aria-hidden="true">⚠</span>
        <span>
          This page excludes Fri/Sat ₱150 registration fees — that cash is
          collected today but not yet recorded anywhere. Do not use this
          page for till reconciliation until Phase 8 adds it.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Net revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCurrency(summary.netRevenueCents)}</p>
            <p className="text-muted-foreground text-xs">
              {summary.weeknightGameCount} game{summary.weeknightGameCount === 1 ? "" : "s"} billed
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Written off</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCurrency(summary.writeOffCents)}</p>
            <p className="text-muted-foreground text-xs">
              {summary.writeOffCount} tab{summary.writeOffCount === 1 ? "" : "s"} — never counted as revenue
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Unsettled</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCurrency(summary.unsettledTotalCents)}</p>
            <p className="text-muted-foreground text-xs">
              {summary.unsettledCount} open tab{summary.unsettledCount === 1 ? "" : "s"} with a balance
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between">
            <span>Weeknight game revenue</span>
            <span>{formatCurrency(summary.weeknightGameRevenueCents)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Equipment rentals</span>
            <span>{formatCurrency(summary.equipmentRentalRevenueCents)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Adjustments (discounts, void reversals)</span>
            <span>{formatCurrency(summary.adjustmentsCents)}</span>
          </div>
          <div className="flex items-center justify-between border-t pt-2 font-medium">
            <span>Net revenue</span>
            <span>{formatCurrency(summary.netRevenueCents)}</span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2">
            <span className="flex items-center gap-2">
              Fri/Sat ₱150 registrations <Badge variant="outline">not yet collected</Badge>
            </span>
            <span className="text-muted-foreground text-xs">{summary.friSatRegistrationFeeNote}</span>
          </div>
        </CardContent>
      </Card>

      {summary.writeOffs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Write-offs ({summary.writeOffs.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {summary.writeOffs.map((writeOff) => (
              <div key={writeOff.tabId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{writeOff.playerName}</span>
                  <span className="text-muted-foreground"> — {writeOff.reason}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{writeOff.employeeName}</Badge>
                  <span className="text-muted-foreground">{formatCurrency(writeOff.amountCents)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>By payment method</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {summary.byPaymentMethod.length === 0 ? (
            <p className="text-muted-foreground text-sm">No settled tabs in this range.</p>
          ) : (
            summary.byPaymentMethod.map((row) => (
              <div key={row.paymentMethodId} className="flex items-center justify-between text-sm">
                <span>
                  {row.label} <span className="text-muted-foreground">({row.count})</span>
                </span>
                <span>{formatCurrency(row.amountCents)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
