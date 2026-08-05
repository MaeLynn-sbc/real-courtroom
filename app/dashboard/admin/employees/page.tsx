import type { Metadata } from "next";

import { auth } from "@/auth";
import { EmployeeCreateForm } from "@/features/employees/components/employee-create-form";
import { EmployeeDetailPanel } from "@/features/employees/components/employee-detail-panel";
import { EmployeeListPanel } from "@/features/employees/components/employee-list-panel";
import { hasPermission } from "@/lib/rbac";
import { employeeService } from "@/services/employee/employee.service";
import { employeeRateService } from "@/services/payroll/employee-rate.service";
import { roleService } from "@/services/role/role.service";
import { PERMISSIONS } from "@/types/permissions";

export const metadata: Metadata = {
  title: "Employees",
};

interface EmployeesPageProps {
  searchParams: Promise<{ employeeId?: string }>;
}

export default async function EmployeesPage({ searchParams }: EmployeesPageProps) {
  const { employeeId } = await searchParams;

  const [employees, roles, session] = await Promise.all([
    employeeService.listEmployees(),
    roleService.listRoles(),
    auth(),
  ]);
  const roleOptions = roles.map((role) => ({ id: role.id, label: role.label }));
  const canManagePayroll = hasPermission(session?.user.permissions ?? [], PERMISSIONS.PAYROLL_MANAGE);

  const selectedEmployee =
    employeeId && employeeId !== "new" ? await employeeService.getEmployeeById(employeeId) : null;
  const loginHistory = selectedEmployee
    ? await employeeService.getLoginHistory(selectedEmployee.id)
    : [];
  const payRate =
    selectedEmployee && canManagePayroll
      ? await employeeRateService.resolveRateForDate(selectedEmployee.id, new Date())
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
        <p className="text-muted-foreground text-sm">
          Create staff accounts, manage roles, and review login activity — everything about one
          employee lives on this screen.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <EmployeeListPanel employees={employees} selectedEmployeeId={employeeId} />

        {employeeId === "new" ? (
          <EmployeeCreateForm roles={roleOptions} />
        ) : selectedEmployee ? (
          <EmployeeDetailPanel
            employee={selectedEmployee}
            roles={roleOptions}
            loginHistory={loginHistory}
            payRate={payRate}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            Select an employee from the list, or create a new one.
          </p>
        )}
      </div>
    </div>
  );
}
