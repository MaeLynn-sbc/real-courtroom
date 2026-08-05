import type { Metadata } from "next";
import Link from "next/link";

import { MarkedDatesManager } from "@/features/payroll/components/marked-dates-manager";
import { payrollMarkedDateService } from "@/services/payroll/payroll-marked-date.service";

export const metadata: Metadata = {
  title: "Payroll — Marked dates",
};

export const dynamic = "force-dynamic";

export default async function MarkedDatesPage() {
  const markedDates = await payrollMarkedDateService.listMarkedDates();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Marked dates</h1>
          <p className="text-muted-foreground text-sm">
            Rest days and holidays. A worked day on one of these dates is flagged
            &quot;premium NOT applied — verify manually&quot; on the pay period preview — it still
            computes at the plain daily rate. No recurrence: mark each occurrence yourself.
          </p>
        </div>
        <Link href="/dashboard/payroll" className="text-primary text-sm underline underline-offset-2">
          ← Back to Payroll
        </Link>
      </div>

      <MarkedDatesManager
        markedDates={markedDates.map((row) => ({ id: row.id, date: row.date, label: row.label }))}
      />
    </div>
  );
}
