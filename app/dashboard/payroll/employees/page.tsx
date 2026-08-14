import type { Metadata } from "next";
import Link from "next/link";

import { formatCurrency } from "@/lib/utils";
import { employeeService } from "@/services/employee/employee.service";
import { employeeRateService } from "@/services/payroll/employee-rate.service";

export const metadata: Metadata = {
  title: "Payroll — Employees",
};

export const dynamic = "force-dynamic";

export default async function PayrollEmployeesPage() {
  const employees = await employeeService.listEmployees();
  const rows = await Promise.all(
    employees.map(async (employee) => ({
      employee,
      rates: await employeeRateService.listRateHistory(employee.id),
    })),
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
          <p className="text-muted-foreground text-sm">
            Pick a person to see their rate history, attendance, and payslips in one place.
          </p>
        </div>
        <Link href="/dashboard/payroll" className="text-primary text-sm underline underline-offset-2">
          ← Back to Payroll
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No active employees yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map(({ employee, rates }) => (
            <li key={employee.id}>
              <Link
                href={`/dashboard/payroll/employees/${employee.id}`}
                className="hover:border-primary/40 hover:bg-accent/40 flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors"
              >
                <span className="flex flex-col">
                  <span className="font-medium">
                    {employee.firstName} {employee.lastName}
                  </span>
                  <span className="text-muted-foreground text-xs">{employee.user.role?.name ?? "—"}</span>
                </span>
                <span className="text-muted-foreground text-xs">
                  {rates[0] ? `${formatCurrency(rates[0].dailyRateCents)}/day` : "No rate set"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
