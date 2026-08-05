import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { AttendanceWorkspace } from "@/features/payroll/components/attendance-workspace";
import { attendanceRecordService } from "@/services/payroll/attendance-record.service";
import { employeeService } from "@/services/employee/employee.service";

export const metadata: Metadata = {
  title: "Payroll",
};

// Same reason as every other admin/ops page in this app — a new manual
// entry or correction must show up immediately, not after the next full
// rebuild.
export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const [employees, recentEntries] = await Promise.all([
    employeeService.listEmployees(),
    attendanceRecordService.listEntries({}),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payroll</h1>
          <p className="text-muted-foreground text-sm">
            Attendance records — manual entry and corrections. Batch 2a: scheduling. No
            rate/hours computation yet.
          </p>
        </div>
        <Link href="/dashboard/payroll/schedule" className={buttonVariants({ variant: "outline" })}>
          Schedule
        </Link>
      </div>

      <AttendanceWorkspace
        employees={employees.map((employee) => ({
          id: employee.id,
          name: `${employee.firstName} ${employee.lastName}`,
        }))}
        entries={recentEntries}
      />
    </div>
  );
}
