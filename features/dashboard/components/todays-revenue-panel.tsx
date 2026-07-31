import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { SalesSummary } from "@/services/sales/sale.service";

const CATEGORY_LABELS: Record<string, string> = {
  BOOKING: "Booking",
  MEMBERSHIP: "Membership",
  EQUIPMENT_RENTAL: "Equipment rental",
  LOCKER_RENTAL: "Locker rental",
  TOURNAMENT_REGISTRATION: "Tournament registration",
  PRODUCT: "Product",
  OTHER: "Other",
};

// Sale-sourced — deliberately a different, narrower number than the
// existing "Billable amount" KPI (which derives from each module's own
// amount fields regardless of whether a Sale was ever created). See
// ARCHITECTURE.md's Sub-phase 3 addendum for why both stay, separately
// labeled, rather than merging into one number.
export function TodaysRevenuePanel({ summary }: { summary: SalesSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today&apos;s revenue</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Total</p>
            <p className="text-lg font-semibold tabular-nums">{formatCurrency(summary.totalAmountCents)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Transactions</p>
            <p className="text-lg font-semibold tabular-nums">{summary.transactionCount}</p>
          </div>
        </div>

        {summary.transactionCount === 0 ? (
          <p className="text-muted-foreground text-sm">No sales recorded today yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground mb-2 text-xs">By category</p>
              <ul className="flex flex-col gap-1.5 text-sm">
                {summary.byCategory.map((row) => (
                  <li
                    key={row.category}
                    className="bg-muted/50 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                  >
                    <span>{CATEGORY_LABELS[row.category] ?? row.category}</span>
                    <span className="tabular-nums font-medium">{formatCurrency(row.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-muted-foreground mb-2 text-xs">By payment method</p>
              <ul className="flex flex-col gap-1.5 text-sm">
                {summary.byPaymentMethod.map((row) => (
                  <li
                    key={row.paymentMethodId}
                    className="bg-muted/50 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                  >
                    <span>{row.label}</span>
                    <span className="tabular-nums font-medium">{formatCurrency(row.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
