import type { Metadata } from "next";

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payroll</h1>
        <p className="text-muted-foreground text-sm">
          Attendance records — manual entry and corrections. Batch 1: no rate/hours computation yet.
        </p>
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
