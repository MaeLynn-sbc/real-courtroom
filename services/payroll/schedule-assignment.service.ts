import type { Prisma, ScheduleAssignment } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

interface AuditLogEntry {
  actorUserId: string;
  action: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

function toMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Same shape/reasoning as attendance-workspace.tsx's own combineDateAndTime,
// server-side: ShiftTemplate.startTime/endTime are bare "HH:MM" strings (a
// repeatable daily window, not a date), combined with a real workDate to
// produce the actual instant a specific day's assignment needs.
function combineDateAndTime(workDate: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(workDate.getFullYear(), workDate.getMonth(), workDate.getDate(), hours, minutes);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export type AssignDayInput =
  | { employeeId: string; workDate: Date; templateId: string; note?: string }
  | {
      employeeId: string;
      workDate: Date;
      scheduledStart: Date;
      scheduledEnd: Date;
      note?: string;
    };

export interface BulkAssignInput {
  employeeId: string;
  templateId: string;
  startDate: Date;
  endDate: Date;
  note?: string;
}

const MAX_BULK_ASSIGN_DAYS = 180;

// Payroll Batch 2a. One row per employee per work day
// (ScheduleAssignment.@@unique([employeeId, workDate])) — "Off" is the
// absence of a row, same idiom as "no GcashDailyBalance row = not
// reconciled yet," not a separate boolean/status field.
export class ScheduleAssignmentService {
  // Backs the roster grid: every active employee x the 7 days starting
  // weekStart, joined with the assigned template's name (if any).
  async getWeek(weekStart: Date) {
    const start = toMidnight(weekStart);
    const end = addDays(start, 7);

    const [employees, assignments] = await Promise.all([
      // Owner request (2026-08-06): this roster is Opening/Closing shift
      // scheduling specifically — only the 3 real Court Attendants work
      // those shifts. Scoped to that one real, owner-managed role (not a
      // SYSTEM_ROLES constant — see types/roles.ts's own comment on why
      // custom roles like this one aren't part of that fixed set) rather
      // than every active employee, which previously also listed the
      // Owner, coaches, and the non-human Website system identity here.
      prisma.employee.findMany({
        where: { isActive: true, deletedAt: null, user: { role: { name: "COURT_ATTENDANT" } } },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      }),
      prisma.scheduleAssignment.findMany({
        where: { workDate: { gte: start, lt: end } },
        include: { template: { select: { id: true, name: true } } },
      }),
    ]);

    return { employees, assignments };
  }

  async listForEmployee(employeeId: string, from: Date, to: Date): Promise<ScheduleAssignment[]> {
    return prisma.scheduleAssignment.findMany({
      where: { employeeId, workDate: { gte: toMidnight(from), lte: toMidnight(to) } },
      orderBy: { workDate: "asc" },
    });
  }

  // A plain upsert, deliberately NOT coach-availability.service.ts's
  // delete-then-recreate pattern — that pattern exists there because
  // CoachAvailabilityWindow has no per-day unique constraint (many window
  // rows can exist per day). ScheduleAssignment already has exactly one
  // row per employee per day by construction (@@unique), so upserting in
  // place is the correct, simpler primitive here. Do not "fix" this to
  // match the coaching file — the two models have genuinely different
  // shapes.
  async assignDay(input: AssignDayInput, actorUserId: string): Promise<ScheduleAssignment> {
    const { assignment, existing } = await this.upsertAssignment(input);

    await this.writeAuditLog({
      actorUserId,
      action: existing ? "schedule_assignment.updated" : "schedule_assignment.created",
      entityId: assignment.id,
      oldValues: existing,
      newValues: assignment,
    });

    return assignment;
  }

  // Shared by assignDay (logs once, per call) and bulkAssign (logs once
  // for the whole range, not once per day — see that method's own
  // comment) — the actual upsert has no audit-logging opinion of its own.
  private async upsertAssignment(
    input: AssignDayInput,
  ): Promise<{ assignment: ScheduleAssignment; existing: ScheduleAssignment | null }> {
    const workDate = toMidnight(input.workDate);
    const isOverride = "scheduledStart" in input;

    let scheduledStart: Date;
    let scheduledEnd: Date;
    let templateId: string | null;

    if (isOverride) {
      scheduledStart = input.scheduledStart;
      scheduledEnd = input.scheduledEnd;
      templateId = null;
      if (scheduledEnd <= scheduledStart) {
        throw new Error("End time must be after start time.");
      }
    } else {
      const template = await prisma.shiftTemplate.findUniqueOrThrow({
        where: { id: input.templateId },
      });
      scheduledStart = combineDateAndTime(workDate, template.startTime);
      scheduledEnd = combineDateAndTime(workDate, template.endTime);
      // Overnight-safe even though neither seeded template needs it today
      // (Opening/Closing both stay within one calendar day) — a future
      // template ending "00:00" or crossing midnight shouldn't silently
      // produce a negative/zero-length window.
      if (scheduledEnd <= scheduledStart) {
        scheduledEnd = addDays(scheduledEnd, 1);
      }
      templateId = template.id;
    }

    const existing = await prisma.scheduleAssignment.findUnique({
      where: { employeeId_workDate: { employeeId: input.employeeId, workDate } },
    });

    const assignment = await prisma.scheduleAssignment.upsert({
      where: { employeeId_workDate: { employeeId: input.employeeId, workDate } },
      update: { templateId, scheduledStart, scheduledEnd, isOverride, note: input.note },
      create: {
        employeeId: input.employeeId,
        workDate,
        templateId,
        scheduledStart,
        scheduledEnd,
        isOverride,
        note: input.note,
      },
    });

    return { assignment, existing };
  }

  async clearDay(employeeId: string, workDate: Date, actorUserId: string): Promise<void> {
    const normalizedDate = toMidnight(workDate);
    const existing = await prisma.scheduleAssignment.findUnique({
      where: { employeeId_workDate: { employeeId, workDate: normalizedDate } },
    });
    if (!existing) {
      return;
    }

    await prisma.scheduleAssignment.delete({ where: { id: existing.id } });

    await this.writeAuditLog({
      actorUserId,
      action: "schedule_assignment.cleared",
      entityId: existing.id,
      oldValues: existing,
    });
  }

  // The repeating-pattern mechanism — materializes a REAL row per day in
  // range (same "materialize per-date, don't build a recurrence-rule
  // engine" philosophy ShiftTemplate/ScheduleAssignment's own schema
  // comments already establish), idempotent on rerun since each day is
  // just assignDay's own upsert. One audit-log entry per call, not per
  // day — a day-by-day log for a 30-day bulk assign would be noise, not
  // signal.
  async bulkAssign(
    input: BulkAssignInput,
    actorUserId: string,
  ): Promise<{ dayCount: number }> {
    const startDate = toMidnight(input.startDate);
    const endDate = toMidnight(input.endDate);
    if (endDate < startDate) {
      throw new Error("End date must be on or after the start date.");
    }

    const dayCount = Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (dayCount > MAX_BULK_ASSIGN_DAYS) {
      throw new Error(
        `That's ${dayCount} days — bulk assign is capped at ${MAX_BULK_ASSIGN_DAYS} at a time. Split it into smaller ranges.`,
      );
    }

    for (let i = 0; i < dayCount; i += 1) {
      const workDate = addDays(startDate, i);
      await this.upsertAssignment({
        employeeId: input.employeeId,
        workDate,
        templateId: input.templateId,
        note: input.note,
      });
    }

    await this.writeAuditLog({
      actorUserId,
      action: "schedule_assignment.bulk_assigned",
      entityId: input.employeeId,
      newValues: {
        employeeId: input.employeeId,
        templateId: input.templateId,
        startDate,
        endDate,
        dayCount,
      },
    });

    return { dayCount };
  }

  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: "ScheduleAssignment",
          entityId: entry.entityId,
          oldValues: toJsonValue(entry.oldValues),
          newValues: toJsonValue(entry.newValues),
        },
      });
    } catch (error) {
      logger.error({ err: error, action: entry.action }, "Failed to write audit log entry");
    }
  }
}

export const scheduleAssignmentService = new ScheduleAssignmentService();
