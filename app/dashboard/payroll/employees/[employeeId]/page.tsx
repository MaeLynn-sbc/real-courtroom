import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AttendanceWorkspace } from "@/features/payroll/components/attendance-workspace";
import { EmployeeRateManager } from "@/features/payroll/components/employee-rate-manager";
import { employeeService } from "@/services/employee/employee.service";
import { attendanceRecordService } from "@/services/payroll/attendance-record.service";
import { employeeRateService } from "@/services/payroll/employee-rate.service";
import { payPeriodService } from "@/services/payroll/pay-period.service";

export const metadata: Metadata = {
  title: "Payroll — Employee profile",
};

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

interface EmployeePayrollProfilePageProps {
  params: Promise<{ employeeId: string }>;
}

export default async function EmployeePayrollProfilePage({ params }: EmployeePayrollProfilePageProps) {
  const { employeeId } = await params;

  const employee = await employeeService.getEmployeeById(employeeId);
  if (!employee) {
    notFound();
  }

  const [rates, entries, periods] = await Promise.all([
    employeeRateService.listRateHistory(employeeId),
    attendanceRecordService.listEntries({ employeeId }),
    payPeriodService.listPeriods(),
  ]);

  const rosterEmployee = [{ id: employee.id, name: `${employee.firstName} ${employee.lastName}` }];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {employee.firstName} {employee.lastName}
          </h1>
          <p className="text-muted-foreground text-sm">
            {employee.user.role?.name ?? "—"} — pay rate, attendance, and payslips.
          </p>
        </div>
        <Link href="/dashboard/payroll/employees" className="text-primary text-sm underline underline-offset-2">
          ← Back to Employees
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pay rate</CardTitle>
        </CardHeader>
        <CardContent>
          <EmployeeRateManager
            employees={rosterEmployee}
            selectedEmployeeId={employeeId}
            rates={rates.map((rate) => ({
              id: rate.id,
              dailyRateCents: rate.dailyRateCents,
              effectiveFrom: rate.effectiveFrom,
              note: rate.note,
            }))}
            hideEmployeePicker
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payslips</CardTitle>
        </CardHeader>
        <CardContent>
          {periods.length === 0 ? (
            <p className="text-muted-foreground text-sm">No pay periods yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {periods.map((period) => (
                <li key={period.id}>
                  <Link
                    href={`/dashboard/payroll/periods/${period.id}?employeeId=${employeeId}`}
                    className="hover:border-primary/40 hover:bg-accent/40 flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors"
                  >
                    <span>
                      {dateFormatter.format(period.startDate)} – {dateFormatter.format(period.endDate)}
                    </span>
                    <span className="text-muted-foreground text-xs tracking-wide uppercase">
                      {period.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attendance</CardTitle>
        </CardHeader>
        <CardContent>
          <AttendanceWorkspace employees={rosterEmployee} entries={entries} hideEmployeePicker />
        </CardContent>
      </Card>
    </div>
  );
}
