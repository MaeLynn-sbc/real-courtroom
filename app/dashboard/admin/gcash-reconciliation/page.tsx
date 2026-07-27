import type { Metadata } from "next";

import { GcashReconciliationWorkspace } from "@/features/gcash/components/gcash-reconciliation-workspace";
import { gcashReconciliationService } from "@/services/gcash/gcash-reconciliation.service";

export const metadata: Metadata = {
  title: "GCash Reconciliation",
};

// Same reason as every other admin/ops page in this app — a confirmed
// balance or a fresh day's carried-forward starting balance must show
// up immediately, not after the next full rebuild.
export const dynamic = "force-dynamic";

export default async function GcashReconciliationPage() {
  const today = new Date();

  // Materializes today's record on demand (carrying the starting
  // balance forward from the most recent CONFIRMED day) — null means
  // no prior CONFIRMED day exists at all yet, so the workspace offers
  // the one-time seed form instead.
  const todayBalance = await gcashReconciliationService.getOrCreateBalanceForDate(today);
  const [expectedEndingBalanceCents, recentBalances] = await Promise.all([
    todayBalance && todayBalance.status === "OPEN"
      ? gcashReconciliationService.getExpectedEndingBalance(todayBalance)
      : Promise.resolve(null),
    gcashReconciliationService.listRecentBalances(14),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">GCash Reconciliation</h1>
        <p className="text-muted-foreground text-sm">
          One shared running balance for the whole business, confirmed once a day — not per shift.
          Tomorrow&apos;s starting balance carries forward automatically once today is confirmed.
        </p>
      </div>

      <GcashReconciliationWorkspace
        needsSeed={todayBalance === null}
        todayBalance={todayBalance}
        expectedEndingBalanceCents={expectedEndingBalanceCents}
        recentBalances={recentBalances}
      />
    </div>
  );
}
