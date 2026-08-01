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
  // "Separate the regular and unli open play payments" — split out of the
  // single SaleCategory.OPEN_PLAY total by sale.service.ts's getSalesSummary
  // (see OpenPlaySummaryCategory's own comment there).
  OPEN_PLAY_REGULAR: "Open Play (regular)",
  OPEN_PLAY_UNLI: "Open Play (unli)",
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
            <p className="text-lg font-semibold tabular-nums">
              {formatCurrency(summary.totalAmountCents)}
            </p>
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
                    // bg-card + a fixed border, not bg-muted/50: this row
                    // sits inside a Card, which is deliberately pinned
                    // white/dark-text in BOTH themes (see card.tsx) — but
                    // --muted is a genuinely different, darker gray in dark
                    // mode, so bg-muted/50 composited over that fixed-white
                    // Card produced a muddy, hard-to-read box (reported
                    // live: "grayish, can barely see the text"). --border
                    // is the same value in both themes, so a plain border
                    // reads consistently either way.
                    className="bg-card border-border/70 text-card-foreground flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                  >
                    <span>{CATEGORY_LABELS[row.category] ?? row.category}</span>
                    <span className="font-medium tabular-nums">
                      {formatCurrency(row.amountCents)}
                    </span>
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
                    // bg-card + a fixed border, not bg-muted/50: this row
                    // sits inside a Card, which is deliberately pinned
                    // white/dark-text in BOTH themes (see card.tsx) — but
                    // --muted is a genuinely different, darker gray in dark
                    // mode, so bg-muted/50 composited over that fixed-white
                    // Card produced a muddy, hard-to-read box (reported
                    // live: "grayish, can barely see the text"). --border
                    // is the same value in both themes, so a plain border
                    // reads consistently either way.
                    className="bg-card border-border/70 text-card-foreground flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                  >
                    <span>{row.label}</span>
                    <span className="font-medium tabular-nums">
                      {formatCurrency(row.amountCents)}
                    </span>
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
