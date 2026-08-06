import type { Metadata } from "next";
import Link from "next/link";

import { PayPeriodList } from "@/features/payroll/components/pay-period-list";
import { payPeriodService } from "@/services/payroll/pay-period.service";

export const metadata: Metadata = {
  title: "Payroll — Pay periods",
};

// Same reason as every other date-scoped dashboard page — a newly
// materialized period must show up immediately.
export const dynamic = "force-dynamic";

export default async function PayPeriodsPage() {
  // Only today's period is auto-generated — see createPeriod/
  // getOrCreatePeriodForDate's own comments for why this deliberately
  // stops short of backfilling a trailing window the way it used to
  // (that undid a manual delete of anything recent). Older history is
  // created explicitly via the "Add period" form below.
  await payPeriodService.getOrCreatePeriodForDate(new Date());
  const periods = await payPeriodService.listPeriods();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pay periods</h1>
          <p className="text-muted-foreground text-sm">
            Semi-monthly, cutoffs at the 10th and 25th (26th–10th, 11th–25th), generated
            automatically. Click a period to preview computed pay — nothing here is saved or
            locked. Edit or remove a period directly if it was generated wrong.
          </p>
        </div>
        <Link href="/dashboard/payroll" className="text-primary text-sm underline underline-offset-2">
          ← Back to Payroll
        </Link>
      </div>

      <PayPeriodList
        periods={periods.map((period) => ({
          id: period.id,
          startDate: period.startDate,
          endDate: period.endDate,
          status: period.status,
        }))}
      />
    </div>
  );
}
