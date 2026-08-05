import type { Metadata } from "next";
import Link from "next/link";

import { EmployeeRateManager } from "@/features/payroll/components/employee-rate-manager";
import { employeeService } from "@/services/employee/employee.service";
import { employeeRateService } from "@/services/payroll/employee-rate.service";

export const metadata: Metadata = {
  title: "Payroll — Rates",
};

export const dynamic = "force-dynamic";

interface EmployeeRatesPageProps {
  searchParams: Promise<{ employeeId?: string }>;
}

export default async function EmployeeRatesPage({ searchParams }: EmployeeRatesPageProps) {
  const { employeeId } = await searchParams;
  const employees = await employeeService.listEmployees();
  const selectedEmployeeId =
    employeeId && employees.some((employee) => employee.id === employeeId)
      ? employeeId
      : (employees[0]?.id ?? "");
  const rates = selectedEmployeeId ? await employeeRateService.listRateHistory(selectedEmployeeId) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pay rates</h1>
          <p className="text-muted-foreground text-sm">
            Effective-dated daily rates. A new rate never rewrites what an earlier day already paid
            at — it only takes effect going forward.
          </p>
        </div>
        <Link href="/dashboard/payroll" className="text-primary text-sm underline underline-offset-2">
          ← Back to Payroll
        </Link>
      </div>

      {employees.length === 0 ? (
        <p className="text-muted-foreground text-sm">No active employees yet.</p>
      ) : (
        <EmployeeRateManager
          employees={employees.map((employee) => ({
            id: employee.id,
            name: `${employee.firstName} ${employee.lastName}`,
          }))}
          selectedEmployeeId={selectedEmployeeId}
          rates={rates.map((rate) => ({
            id: rate.id,
            dailyRateCents: rate.dailyRateCents,
            effectiveFrom: rate.effectiveFrom,
            note: rate.note,
          }))}
        />
      )}
    </div>
  );
}
