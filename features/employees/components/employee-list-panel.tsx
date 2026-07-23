"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { employeeService } from "@/services/employee/employee.service";

type Employees = Awaited<ReturnType<typeof employeeService.listEmployees>>;

interface EmployeeListPanelProps {
  employees: Employees;
  selectedEmployeeId?: string;
}

export function EmployeeListPanel({ employees, selectedEmployeeId }: EmployeeListPanelProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return employees;
    }
    return employees.filter((employee) => {
      const haystack =
        `${employee.firstName} ${employee.lastName} ${employee.employeeNumber} ${employee.user.username ?? ""}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [employees, query]);

  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/dashboard/admin/employees?employeeId=new"
        className={cn(
          "flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm font-medium transition-colors",
          selectedEmployeeId === "new"
            ? "border-primary bg-muted"
            : "hover:border-primary/50 hover:bg-muted/30",
        )}
      >
        <Plus className="size-4" aria-hidden="true" />
        New employee
      </Link>

      <Input
        placeholder="Search employees…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="flex flex-col gap-1">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground px-3 py-2 text-sm">No employees match.</p>
        ) : (
          filtered.map((employee) => {
            const isActive = employee.id === selectedEmployeeId;
            return (
              <Link
                key={employee.id}
                href={`/dashboard/admin/employees?employeeId=${employee.id}`}
                className={cn(
                  "flex flex-col rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted/50",
                )}
              >
                <span className="flex items-center justify-between gap-2 font-medium">
                  {employee.firstName} {employee.lastName}
                  {/* v1.1 Sub-phase 5: this used to read `isActive` here —
                      the row-selection flag, not employee.isActive — so
                      the badge's color was accidentally tied to whether
                      this row was selected, not whether the employee was
                      actually active. Always destructive now, regardless
                      of selection. */}
                  {!employee.isActive ? <Badge variant="destructive">Inactive</Badge> : null}
                </span>
                <span className={cn("text-xs", isActive ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  {employee.employeeNumber} · {employee.user.role.label}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
