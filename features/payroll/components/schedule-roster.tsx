"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { assignDayAction, bulkAssignAction, clearDayAction } from "@/actions/schedule-assignment.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface RosterEmployee {
  id: string;
  name: string;
}

interface RosterTemplate {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
}

interface RosterAssignment {
  employeeId: string;
  workDate: Date;
  templateId: string | null;
  templateName: string | null;
  scheduledStart: Date;
  scheduledEnd: Date;
  isOverride: boolean;
}

interface ScheduleRosterProps {
  weekStart: Date;
  employees: RosterEmployee[];
  templates: RosterTemplate[];
  assignments: RosterAssignment[];
}

const OFF_VALUE = "__off__";
const CUSTOM_VALUE = "__custom__";

const dayFormatter = new Intl.DateTimeFormat("en-PH", { weekday: "short", day: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" });

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function toDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Owner request (2026-08-05): "there's 2 shifts, 7-3pm and 3pm-11pm opens
// daily." Rows = active employees, columns = the 7 days of the selected
// week — a genuinely different shape from the one-employee x 24-hours
// HourGrid (components/shared/hour-grid.tsx), so this is its own
// component, not a reuse of that one. The week-nav itself (Monday start,
// Prev/This/Next) lives in the parent page, matching
// coach-availability-manager.tsx's own convention for that scaffolding.
export function ScheduleRoster({ weekStart, employees, templates, assignments }: ScheduleRosterProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [customCell, setCustomCell] = useState<{ employeeId: string; workDate: Date } | null>(null);
  const [customStart, setCustomStart] = useState("07:00");
  const [customEnd, setCustomEnd] = useState("15:00");

  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  function findAssignment(employeeId: string, day: Date): RosterAssignment | undefined {
    return assignments.find((a) => a.employeeId === employeeId && isSameDay(a.workDate, day));
  }

  function handleSelect(employeeId: string, day: Date, value: string) {
    if (value === CUSTOM_VALUE) {
      setCustomCell({ employeeId, workDate: day });
      return;
    }

    startTransition(async () => {
      const result =
        value === OFF_VALUE
          ? await clearDayAction({ employeeId, workDate: day })
          : await assignDayAction({ employeeId, workDate: day, templateId: value });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleSaveCustom() {
    if (!customCell) return;
    const [startHour, startMinute] = customStart.split(":").map(Number);
    const [endHour, endMinute] = customEnd.split(":").map(Number);
    const workDate = customCell.workDate;
    const scheduledStart = new Date(
      workDate.getFullYear(),
      workDate.getMonth(),
      workDate.getDate(),
      startHour,
      startMinute,
    );
    const scheduledEnd = new Date(
      workDate.getFullYear(),
      workDate.getMonth(),
      workDate.getDate(),
      endHour,
      endMinute,
    );

    startTransition(async () => {
      const result = await assignDayAction({
        employeeId: customCell.employeeId,
        workDate: customCell.workDate,
        scheduledStart,
        scheduledEnd,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setCustomCell(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {employees.length === 0 ? (
        <p className="text-muted-foreground text-sm">No active employees to schedule.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40">
                <th className="text-muted-foreground w-40 border-b px-3 py-2 text-left text-xs font-medium">
                  Employee
                </th>
                {days.map((day) => (
                  <th
                    key={day.toISOString()}
                    className="border-b px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide"
                  >
                    {dayFormatter.format(day)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id} className="border-t">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{employee.name}</td>
                  {days.map((day) => {
                    const assignment = findAssignment(employee.id, day);
                    const isEditingCustom =
                      customCell?.employeeId === employee.id && isSameDay(customCell.workDate, day);
                    const selectValue = assignment
                      ? assignment.isOverride
                        ? CUSTOM_VALUE
                        : (assignment.templateId ?? OFF_VALUE)
                      : OFF_VALUE;

                    return (
                      <td key={day.toISOString()} className="p-1.5 align-top">
                        {isEditingCustom ? (
                          <div className="flex flex-col gap-1 rounded-md border border-dashed p-1.5">
                            <Input
                              type="time"
                              value={customStart}
                              onChange={(event) => setCustomStart(event.target.value)}
                              className="h-7 text-xs"
                            />
                            <Input
                              type="time"
                              value={customEnd}
                              onChange={(event) => setCustomEnd(event.target.value)}
                              className="h-7 text-xs"
                            />
                            <div className="flex gap-1">
                              <Button
                                type="button"
                                size="sm"
                                className="h-6 flex-1 px-1 text-[11px]"
                                disabled={isPending}
                                onClick={handleSaveCustom}
                              >
                                Save
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 flex-1 px-1 text-[11px]"
                                disabled={isPending}
                                onClick={() => setCustomCell(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Select
                            value={selectValue}
                            onValueChange={(value) => value && handleSelect(employee.id, day, value)}
                          >
                            <SelectTrigger
                              className={cn(
                                "h-9 w-full text-xs",
                                selectValue === OFF_VALUE
                                  ? "text-muted-foreground"
                                  : "border-court-blue text-court-blue",
                              )}
                            >
                              <SelectValue>
                                {assignment
                                  ? assignment.isOverride
                                    ? `${timeFormatter.format(assignment.scheduledStart)}–${timeFormatter.format(assignment.scheduledEnd)}`
                                    : (assignment.templateName ?? "Off")
                                  : "Off"}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={OFF_VALUE}>Off</SelectItem>
                              {templates.map((template) => (
                                <SelectItem key={template.id} value={template.id}>
                                  {template.name} ({template.startTime}–{template.endTime})
                                </SelectItem>
                              ))}
                              <SelectItem value={CUSTOM_VALUE}>Custom hours…</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BulkAssignPanel employees={employees} templates={templates} weekStart={weekStart} />
    </div>
  );
}

function BulkAssignPanel({
  employees,
  templates,
  weekStart,
}: {
  employees: RosterEmployee[];
  templates: RosterTemplate[];
  weekStart: Date;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [startDate, setStartDate] = useState(toDateValue(weekStart));
  const [endDate, setEndDate] = useState(toDateValue(addDays(weekStart, 6)));
  const [note, setNote] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!employeeId || !templateId) return;

    startTransition(async () => {
      const result = await bulkAssignAction({
        employeeId,
        templateId,
        startDate: new Date(`${startDate}T00:00:00`),
        endDate: new Date(`${endDate}T00:00:00`),
        note: note.trim() || undefined,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Assigned ${result.dayCount} day${result.dayCount === 1 ? "" : "s"}.`);
      router.refresh();
    });
  }

  if (employees.length === 0 || templates.length === 0) {
    return null;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">Bulk assign</h2>
      <p className="text-muted-foreground text-xs">
        Repeat one shift for an employee across a date range — e.g. &quot;Opening, every day this
        month.&quot;
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulkEmployee">Employee</Label>
          <Select value={employeeId} onValueChange={(value) => value && setEmployeeId(value)}>
            <SelectTrigger id="bulkEmployee">
              <SelectValue>{employees.find((e) => e.id === employeeId)?.name ?? "Select"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {employees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulkTemplate">Shift</Label>
          <Select value={templateId} onValueChange={(value) => value && setTemplateId(value)}>
            <SelectTrigger id="bulkTemplate">
              <SelectValue>{templates.find((t) => t.id === templateId)?.name ?? "Select"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name} ({template.startTime}–{template.endTime})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulkStart">From</Label>
          <Input
            id="bulkStart"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulkEnd">To</Label>
          <Input id="bulkEnd" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Assigning…" : "Apply"}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bulkNote">Note (optional)</Label>
        <Input
          id="bulkNote"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. covering for a coworker on leave"
        />
      </div>
    </form>
  );
}
