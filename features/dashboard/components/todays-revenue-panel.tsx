import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { SalesSummary } from "@/services/sales/sale.service";

const CATEGORY_LABELS: Record<string, string> = {
  BOOKING: "Booking",
  // Reported live (2026-08-04): missing here, so this row fell back to
  // the raw enum string "COACHING" — the one all-caps label sitting
  // among every other category's normal-case one.
  COACHING: "Coaching",
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
// Fixed palette rather than theme tokens: this Card is deliberately
// pinned white with dark text in BOTH themes (see card.tsx and the
// removed rows' own note below), so a token that shifts between themes
// would be tuned for only one of them. These read on white either way.
const BAR_COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-orange-500",
] as const;

/** Presentation only — the rows, order and amounts are exactly what
 * getSalesSummary already returns. Previously each row was a bordered
 * box holding a label and a peso figure, every box identical in weight:
 * nothing showed that bookings were nearly half of the day's takings
 * without reading all four numbers and doing the arithmetic. A bar
 * against the largest row in its own group makes the split legible at a
 * glance, which is the entire job of this panel. */
function BreakdownBar({
  label,
  amountCents,
  maxCents,
  colorIndex,
}: {
  label: string;
  amountCents: number;
  maxCents: number;
  colorIndex: number;
}) {
  // Guard against a zero/absent max (every row zero) — never NaN width.
  const pct = maxCents > 0 ? Math.max(2, Math.round((amountCents / maxCents) * 100)) : 0;

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(amountCents)}</span>
      </div>
      <div className="bg-border/70 h-1.5 w-full overflow-hidden rounded-full">
        <div
          className={`h-full rounded-full ${BAR_COLORS[colorIndex % BAR_COLORS.length]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  );
}

export function TodaysRevenuePanel({ summary }: { summary: SalesSummary }) {
  const maxCategoryCents = Math.max(0, ...summary.byCategory.map((row) => row.amountCents));
  const maxMethodCents = Math.max(0, ...summary.byPaymentMethod.map((row) => row.amountCents));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today&apos;s revenue</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-muted-foreground text-xs">Total</p>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatCurrency(summary.totalAmountCents)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Transactions</p>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">
              {summary.transactionCount}
            </p>
          </div>
        </div>

        {summary.transactionCount > 0 ? (
          <p className="text-muted-foreground text-xs">
            Avg. transaction{" "}
            <span className="text-foreground font-semibold tabular-nums">
              {formatCurrency(Math.round(summary.totalAmountCents / summary.transactionCount))}
            </span>
          </p>
        ) : null}

        {summary.transactionCount === 0 ? (
          <p className="text-muted-foreground text-sm">No sales recorded today yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground mb-3 text-[10px] font-bold tracking-[0.12em] uppercase">
                By category
              </p>
              <ul className="flex flex-col gap-3">
                {summary.byCategory.map((row, index) => (
                  <BreakdownBar
                    key={row.category}
                    label={CATEGORY_LABELS[row.category] ?? row.category}
                    amountCents={row.amountCents}
                    maxCents={maxCategoryCents}
                    colorIndex={index}
                  />
                ))}
              </ul>
            </div>
            <div>
              <p className="text-muted-foreground mb-3 text-[10px] font-bold tracking-[0.12em] uppercase">
                By payment method
              </p>
              <ul className="flex flex-col gap-3">
                {summary.byPaymentMethod.map((row, index) => (
                  <BreakdownBar
                    key={row.paymentMethodId}
                    label={row.label}
                    amountCents={row.amountCents}
                    maxCents={maxMethodCents}
                    colorIndex={index}
                  />
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
