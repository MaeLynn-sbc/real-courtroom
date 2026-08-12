import type { Metadata } from "next";
import Link from "next/link";

import { ReconciliationTabs } from "@/components/shared/reconciliation-tabs";
import { CashReconciliationWorkspace } from "@/features/cash/components/cash-reconciliation-workspace";
import { GcashReconciliationWorkspace } from "@/features/gcash/components/gcash-reconciliation-workspace";
import { computeBusinessDate } from "@/lib/business-date";
import { cashReconciliationService, PriorDayNotClosedError as CashPriorDayNotClosedError } from "@/services/cash/cash-reconciliation.service";
import { expenseCategoryService } from "@/services/expenses/expense-category.service";
import { expenseService } from "@/services/expenses/expense.service";
import { gcashReconciliationService, PriorDayNotClosedError as GcashPriorDayNotClosedError } from "@/services/gcash/gcash-reconciliation.service";
import { saleService } from "@/services/sales/sale.service";
import { settingsService } from "@/services/settings/settings.service";
import type { CashDailyBalance, GcashDailyBalance } from "@/lib/generated/prisma/client";

// Real incident (2026-08-07): getOrCreateBalanceForDate now throws
// PriorDayNotClosedError instead of silently materializing a day with a
// stale starting balance when the immediately preceding day is still
// OPEN — this turns that into a result the page can render around
// (a warning, not a crash) instead of letting it propagate as an
// unhandled Server Component error.
async function loadBalance<T>(
  load: () => Promise<T | null>,
  isPriorDayError: (error: unknown) => error is { message: string },
): Promise<{ balance: T | null; priorDayError: string | null }> {
  try {
    return { balance: await load(), priorDayError: null };
  } catch (error) {
    if (isPriorDayError(error)) {
      return { balance: null, priorDayError: error.message };
    }
    throw error;
  }
}

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
  // Owner-directed consolidation (2026-08-12): "today" (when no ?date=
  // is given) is now the same rollover-hour-aware computeBusinessDate
  // every other correct part of the app uses, not literal calendar
  // midnight — a day confirmed before the rollover hour no longer
  // resets to a fresh, empty "today" out from under a still-open shift.
  const courtHours = await settingsService.getCourtHours();
  // Reported live (2026-08-04): "there's no option to close it" — a day
  // confirmed too early had no way back, because this page only ever
  // showed "today," with no way to reach any other date at all — not
  // even a genuinely stuck, never-confirmed past day like the one
  // sitting right behind today's premature close. ?date= (surfaced via
  // the Recent days table below becoming links) opens any date the same
  // way "today" always has; omitted, it's today exactly as before.
  const viewedDate = dateParam
    ? new Date(`${dateParam}T00:00:00`)
    : computeBusinessDate(new Date(), courtHours.businessDateRolloverHour);
  const today = computeBusinessDate(new Date(), courtHours.businessDateRolloverHour);
  const isViewingToday =
    viewedDate.getFullYear() === today.getFullYear() &&
    viewedDate.getMonth() === today.getMonth() &&
    viewedDate.getDate() === today.getDate();
  const viewedDateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "full" });

  // Materializes the viewed date's record on demand (carrying the
  // starting balance forward from the most recent CONFIRMED day) — null
  // means no prior CONFIRMED day exists at all yet, so the workspace
  // offers the one-time seed form instead. GCash and Cash are entirely
  // independent day-scoped balances, fetched in parallel. A thrown
  // PriorDayNotClosedError (the immediately preceding day is still
  // OPEN) is caught and turned into a warning the workspace renders
  // instead — see loadBalance's own comment.
  const [gcashResult, cashResult] = await Promise.all([
    loadBalance(
      () => gcashReconciliationService.getOrCreateBalanceForDate(viewedDate),
      (error): error is GcashPriorDayNotClosedError => error instanceof GcashPriorDayNotClosedError,
    ),
    loadBalance(
      () => cashReconciliationService.getOrCreateBalanceForDate(viewedDate),
      (error): error is CashPriorDayNotClosedError => error instanceof CashPriorDayNotClosedError,
    ),
  ]);
  const gcashTodayBalance: GcashDailyBalance | null = gcashResult.balance;
  const cashTodayBalance: CashDailyBalance | null = cashResult.balance;
  const [
    gcashExpectedEndingBalanceCents,
    gcashRecentBalances,
    cashExpectedEndingBalanceCents,
    cashRecentBalances,
    gcashExpensesCents,
    cashExpensesCents,
    expenseCategories,
    paymentMethods,
  ] = await Promise.all([
    gcashTodayBalance && gcashTodayBalance.status === "OPEN"
      ? gcashReconciliationService.getExpectedEndingBalance(gcashTodayBalance)
      : Promise.resolve(null),
    gcashReconciliationService.listRecentBalances(14),
    cashTodayBalance && cashTodayBalance.status === "OPEN"
      ? cashReconciliationService.getExpectedEndingBalance(cashTodayBalance)
      : Promise.resolve(null),
    cashReconciliationService.listRecentBalances(14),
    // Owner request (2026-08-07): shown in both workspaces regardless of
    // OPEN/CONFIRMED status — "explains the deficit" applies to a day
    // already closed just as much as one still open.
    expenseService.getGcashExpensesForDate(viewedDate),
    expenseService.getCashExpensesForDate(viewedDate),
    expenseCategoryService.listCategories(false),
    saleService.listPaymentMethods(),
  ]);
  const cashPaymentMethodId = paymentMethods.find((method) => method.key === "CASH")?.id ?? "";
  const gcashPaymentMethodId = paymentMethods.find((method) => method.key === "GCASH")?.id ?? "";

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
            needsSeed={gcashTodayBalance === null && gcashResult.priorDayError === null}
            priorDayError={gcashResult.priorDayError}
            todayBalance={gcashTodayBalance}
            expectedEndingBalanceCents={gcashExpectedEndingBalanceCents}
            expensesCents={gcashExpensesCents}
            recentBalances={gcashRecentBalances}
            expenseCategories={expenseCategories}
            expensePaymentMethods={paymentMethods}
            gcashPaymentMethodId={gcashPaymentMethodId}
          />
        }
        cash={
          <CashReconciliationWorkspace
            needsSeed={cashTodayBalance === null && cashResult.priorDayError === null}
            priorDayError={cashResult.priorDayError}
            todayBalance={cashTodayBalance}
            expectedEndingBalanceCents={cashExpectedEndingBalanceCents}
            expensesCents={cashExpensesCents}
            recentBalances={cashRecentBalances}
            expenseCategories={expenseCategories}
            expensePaymentMethods={paymentMethods}
            cashPaymentMethodId={cashPaymentMethodId}
          />
        }
      />
    </div>
  );
}
