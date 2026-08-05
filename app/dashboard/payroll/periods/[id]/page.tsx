import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PayPeriodPreview } from "@/features/payroll/components/pay-period-preview";
import { employeeService } from "@/services/employee/employee.service";
import { payPeriodService } from "@/services/payroll/pay-period.service";
import { payrollComputationService } from "@/services/payroll/payroll-computation.service";

export const metadata: Metadata = {
  title: "Payroll — Pay period preview",
};

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

interface PayPeriodDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ employeeId?: string }>;
}

export default async function PayPeriodDetailPage({ params, searchParams }: PayPeriodDetailPageProps) {
  const { id } = await params;
  const { employeeId } = await searchParams;

  const [period, employees] = await Promise.all([
    payPeriodService.getPeriodById(id),
    employeeService.listEmployees(),
  ]);
  if (!period) {
    notFound();
  }

  const selectedEmployeeId =
    employeeId && employees.some((employee) => employee.id === employeeId)
      ? employeeId
      : (employees[0]?.id ?? "");

  const computation = selectedEmployeeId
    ? await payrollComputationService.computeEmployeePeriod(selectedEmployeeId, id)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {dateFormatter.format(period.startDate)} – {dateFormatter.format(period.endDate)}
          </h1>
          <p className="text-muted-foreground text-sm">
            Preview only — this is a read-only computation, nothing here is saved or locked.
          </p>
        </div>
        <Link href="/dashboard/payroll/periods" className="text-primary text-sm underline underline-offset-2">
          ← Back to Pay periods
        </Link>
      </div>

      {employees.length === 0 ? (
        <p className="text-muted-foreground text-sm">No active employees yet.</p>
      ) : (
        <PayPeriodPreview
          periodId={id}
          employees={employees.map((employee) => ({
            id: employee.id,
            name: `${employee.firstName} ${employee.lastName}`,
          }))}
          selectedEmployeeId={selectedEmployeeId}
          days={computation?.days ?? []}
          totals={
            computation?.totals ?? {
              regularMinutes: 0,
              otMinutes: 0,
              nightDiffMinutes: 0,
              lateDeductedMinutes: 0,
              undertimeMinutes: 0,
              grossCents: 0,
            }
          }
        />
      )}
    </div>
  );
}
