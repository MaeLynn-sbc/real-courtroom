import type { Metadata } from "next";

import { ReconciliationTabs } from "@/components/shared/reconciliation-tabs";
import { CashReconciliationWorkspace } from "@/features/cash/components/cash-reconciliation-workspace";
import { GcashReconciliationWorkspace } from "@/features/gcash/components/gcash-reconciliation-workspace";
import { cashReconciliationService } from "@/services/cash/cash-reconciliation.service";
import { gcashReconciliationService } from "@/services/gcash/gcash-reconciliation.service";

export const metadata: Metadata = {
  title: "Cash & GCash Reconciliation",
};

// Same reason as every other admin/ops page in this app — a confirmed
// balance or a fresh day's carried-forward starting balance must show
// up immediately, not after the next full rebuild.
export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const today = new Date();

  // Materializes today's record on demand (carrying the starting
  // balance forward from the most recent CONFIRMED day) — null means
  // no prior CONFIRMED day exists at all yet, so the workspace offers
  // the one-time seed form instead. GCash and Cash are entirely
  // independent day-scoped balances, fetched in parallel.
  const [gcashTodayBalance, cashTodayBalance] = await Promise.all([
    gcashReconciliationService.getOrCreateBalanceForDate(today),
    cashReconciliationService.getOrCreateBalanceForDate(today),
  ]);
  const [
    gcashExpectedEndingBalanceCents,
    gcashRecentBalances,
    cashExpectedEndingBalanceCents,
    cashRecentBalances,
  ] = await Promise.all([
    gcashTodayBalance && gcashTodayBalance.status === "OPEN"
      ? gcashReconciliationService.getExpectedEndingBalance(gcashTodayBalance)
      : Promise.resolve(null),
    gcashReconciliationService.listRecentBalances(14),
    cashTodayBalance && cashTodayBalance.status === "OPEN"
      ? cashReconciliationService.getExpectedEndingBalance(cashTodayBalance)
      : Promise.resolve(null),
    cashReconciliationService.listRecentBalances(14),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cash &amp; GCash Reconciliation</h1>
        <p className="text-muted-foreground text-sm">
          One shared running balance per payment method, confirmed once a day — not per shift.
          Tomorrow&apos;s starting balance carries forward automatically once today is confirmed.
        </p>
      </div>

      <ReconciliationTabs
        gcash={
          <GcashReconciliationWorkspace
            needsSeed={gcashTodayBalance === null}
            todayBalance={gcashTodayBalance}
            expectedEndingBalanceCents={gcashExpectedEndingBalanceCents}
            recentBalances={gcashRecentBalances}
          />
        }
        cash={
          <CashReconciliationWorkspace
            needsSeed={cashTodayBalance === null}
            todayBalance={cashTodayBalance}
            expectedEndingBalanceCents={cashExpectedEndingBalanceCents}
            recentBalances={cashRecentBalances}
          />
        }
      />
    </div>
  );
}
