import type { Metadata } from "next";
import Link from "next/link";

import { payPeriodService } from "@/services/payroll/pay-period.service";

export const metadata: Metadata = {
  title: "Payroll — Pay periods",
};

// Same reason as every other date-scoped dashboard page — a newly
// materialized period must show up immediately.
export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

export default async function PayPeriodsPage() {
  await payPeriodService.ensurePeriodsThroughDate(new Date());
  const periods = await payPeriodService.listPeriods();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pay periods</h1>
          <p className="text-muted-foreground text-sm">
            Semi-monthly (1st–15th, 16th–end of month), generated automatically. Click a period to
            preview computed pay — nothing here is saved or locked.
          </p>
        </div>
        <Link href="/dashboard/payroll" className="text-primary text-sm underline underline-offset-2">
          ← Back to Payroll
        </Link>
      </div>

      {periods.length === 0 ? (
        <p className="text-muted-foreground text-sm">No pay periods yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {periods.map((period) => (
            <li key={period.id}>
              <Link
                href={`/dashboard/payroll/periods/${period.id}`}
                className="hover:bg-muted flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <span>
                  {dateFormatter.format(period.startDate)} – {dateFormatter.format(period.endDate)}
                </span>
                <span className="text-muted-foreground text-xs uppercase tracking-wide">{period.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
