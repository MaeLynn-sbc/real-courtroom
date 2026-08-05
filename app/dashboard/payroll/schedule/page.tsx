import type { Metadata } from "next";
import Link from "next/link";

import { ScheduleRoster } from "@/features/payroll/components/schedule-roster";
import { scheduleAssignmentService } from "@/services/payroll/schedule-assignment.service";
import { shiftTemplateService } from "@/services/payroll/shift-template.service";

export const metadata: Metadata = {
  title: "Payroll — Schedule",
};

// Same reason as every other date-scoped dashboard page — a new
// assignment must show up immediately.
export const dynamic = "force-dynamic";

function startOfWeek(date: Date): Date {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start, same convention
  // as coach-availability-manager.tsx's own startOfWeek.
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + diff);
  return result;
}

function toDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

interface SchedulePageProps {
  searchParams: Promise<{ week?: string }>;
}

export default async function SchedulePage({ searchParams }: SchedulePageProps) {
  const { week: weekParam } = await searchParams;
  const requestedDate = weekParam ? new Date(`${weekParam}T00:00:00`) : new Date();
  const weekStart = startOfWeek(requestedDate);

  const [{ employees, assignments }, templates] = await Promise.all([
    scheduleAssignmentService.getWeek(weekStart),
    shiftTemplateService.listTemplates(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
          <p className="text-muted-foreground text-sm">
            Who&apos;s working Opening or Closing each day. Payroll Batch 2a — no
            hours/pay computation reads this yet.
          </p>
        </div>
        <Link href="/dashboard/payroll" className="text-primary text-sm underline underline-offset-2">
          ← Back to Payroll
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <Link
          href={`/dashboard/payroll/schedule?week=${toDateValue(addDays(weekStart, -7))}`}
          className="border-input hover:bg-muted rounded-md border px-3 py-1.5 text-sm"
        >
          ← Prev week
        </Link>
        <Link
          href="/dashboard/payroll/schedule"
          className="border-input hover:bg-muted rounded-md border px-3 py-1.5 text-sm"
        >
          This week
        </Link>
        <Link
          href={`/dashboard/payroll/schedule?week=${toDateValue(addDays(weekStart, 7))}`}
          className="border-input hover:bg-muted rounded-md border px-3 py-1.5 text-sm"
        >
          Next week →
        </Link>
      </div>

      <ScheduleRoster
        weekStart={weekStart}
        employees={employees.map((employee) => ({
          id: employee.id,
          name: `${employee.firstName} ${employee.lastName}`,
        }))}
        templates={templates
          .filter((template) => template.active)
          .map((template) => ({
            id: template.id,
            name: template.name,
            startTime: template.startTime,
            endTime: template.endTime,
          }))}
        assignments={assignments.map((assignment) => ({
          employeeId: assignment.employeeId,
          workDate: assignment.workDate,
          templateId: assignment.templateId,
          templateName: assignment.template?.name ?? null,
          scheduledStart: assignment.scheduledStart,
          scheduledEnd: assignment.scheduledEnd,
          isOverride: assignment.isOverride,
        }))}
      />
    </div>
  );
}
