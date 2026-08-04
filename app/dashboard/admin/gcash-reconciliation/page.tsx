import type { Metadata } from "next";
import Link from "next/link";

import { ReconciliationTabs } from "@/components/shared/reconciliation-tabs";
import { CashReconciliationWorkspace } from "@/features/cash/components/cash-reconciliation-workspace";
import { GcashReconciliationWorkspace } from "@/features/gcash/components/gcash-reconciliation-workspace";
import { cashReconciliationService } from "@/services/cash/cash-reconciliation.service";
import { gcashReconciliationService } from "@/services/gcash/gcash-reconciliation.service";

export const metadata: Metadata = {
  title: "Accounts Reconciliation",
};

// Same reason as every other admin/ops page in this app — a confirmed
// balance or a fresh day's carried-forward starting balance must show
// up immediately, not after the next full rebuild.
export const dynamic = "force-dynamic";

interface ReconciliationPageProps {
  searchParams: Promise<{ date?: string }>;
}

export default async function ReconciliationPage({ searchParams }: ReconciliationPageProps) {
  const { date: dateParam } = await searchParams;
  // Reported live (2026-08-04): "there's no option to close it" — a day
  // confirmed too early had no way back, because this page only ever
  // showed "today," with no way to reach any other date at all — not
  // even a genuinely stuck, never-confirmed past day like the one
  // sitting right behind today's premature close. ?date= (surfaced via
  // the Recent days table below becoming links) opens any date the same
  // way "today" always has; omitted, it's today exactly as before.
  const viewedDate = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
  const today = new Date();
  const isViewingToday =
    viewedDate.getFullYear() === today.getFullYear() &&
    viewedDate.getMonth() === today.getMonth() &&
    viewedDate.getDate() === today.getDate();
  const viewedDateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "full" });

  // Materializes the viewed date's record on demand (carrying the
  // starting balance forward from the most recent CONFIRMED day) — null
  // means no prior CONFIRMED day exists at all yet, so the workspace
  // offers the one-time seed form instead. GCash and Cash are entirely
  // independent day-scoped balances, fetched in parallel.
  const [gcashTodayBalance, cashTodayBalance] = await Promise.all([
    gcashReconciliationService.getOrCreateBalanceForDate(viewedDate),
    cashReconciliationService.getOrCreateBalanceForDate(viewedDate),
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
        <h1 className="text-2xl font-semibold tracking-tight">Accounts Reconciliation</h1>
        <p className="text-muted-foreground text-sm">
          One shared running balance per payment method, confirmed once a day — not per shift.
          Tomorrow&apos;s starting balance carries forward automatically once today is confirmed.
        </p>
      </div>

      {!isViewingToday ? (
        <div className="bg-muted/40 flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
          <span>
            Viewing <strong>{viewedDateFormatter.format(viewedDate)}</strong> — not today.
          </span>
          <Link href="/dashboard/admin/gcash-reconciliation" className="text-primary hover:underline">
            Back to today
          </Link>
        </div>
      ) : null}

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
