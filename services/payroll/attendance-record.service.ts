import type { AttendanceRecord, Prisma } from "@/lib/generated/prisma/client";
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

export class AttendanceRecordAlreadyExistsError extends Error {
  constructor() {
    super("An attendance record already exists for this employee on this work date.");
    this.name = "AttendanceRecordAlreadyExistsError";
  }
}

export interface CreateManualAttendanceEntryInput {
  employeeId: string;
  workDate: Date;
  clockIn: Date;
  clockOut?: Date | null;
}

export interface CorrectAttendanceEntryInput {
  recordId: string;
  clockIn: Date;
  clockOut?: Date | null;
  reason: string;
}

// Payroll Batch 1 — manual entry only. No live-seeding from Shift yet
// (source is always MANUAL here; LIVE is wired in a later batch), no
// rate/hours computation (that's the computation-engine batch). See
// AttendanceRecord's own schema comment for the full list of fields
// deliberately not touched by this batch.
export class AttendanceRecordService {
  // rawClockIn/rawClockOut are captured from clockIn/clockOut at THIS
  // moment, once, and never written again by correctEntry below — the
  // whole point of "raw" is that it survives every later correction
  // unchanged, so a corrected record still shows what was originally
  // entered.
  async createManualEntry(
    input: CreateManualAttendanceEntryInput,
    actorUserId: string,
  ): Promise<AttendanceRecord> {
    const workDate = toMidnight(input.workDate);

    const existing = await prisma.attendanceRecord.findUnique({
      where: { employeeId_workDate: { employeeId: input.employeeId, workDate } },
    });
    if (existing) {
      throw new AttendanceRecordAlreadyExistsError();
    }

    const record = await prisma.attendanceRecord.create({
      data: {
        employeeId: input.employeeId,
        workDate,
        clockIn: input.clockIn,
        clockOut: input.clockOut ?? null,
        rawClockIn: input.clockIn,
        rawClockOut: input.clockOut ?? null,
        source: "MANUAL",
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "attendance_record.created",
      entityId: record.id,
      newValues: record,
    });

    return record;
  }

  // Required reason, same "who/when/why" shape as GcashDailyBalance's
  // overrideStartingBalance and TimeLogEntry's own correction fields —
  // updates clockIn/clockOut (the payroll-editable value) but never
  // touches rawClockIn/rawClockOut.
  async correctEntry(
    input: CorrectAttendanceEntryInput,
    actorUserId: string,
  ): Promise<AttendanceRecord> {
    if (!input.reason.trim()) {
      throw new Error("A reason is required to correct an attendance record.");
    }

    const existing = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { id: input.recordId },
    });

    const record = await prisma.attendanceRecord.update({
      where: { id: input.recordId },
      data: {
        clockIn: input.clockIn,
        clockOut: input.clockOut ?? null,
        correctedByUserId: actorUserId,
        correctedAt: new Date(),
        correctionReason: input.reason,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "attendance_record.corrected",
      entityId: record.id,
      oldValues: existing,
      newValues: record,
    });

    return record;
  }

  async listEntries(filter: { employeeId?: string; from?: Date; to?: Date }) {
    return prisma.attendanceRecord.findMany({
      where: {
        employeeId: filter.employeeId,
        workDate: { gte: filter.from, lte: filter.to },
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        correctedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { workDate: "desc" },
    });
  }

  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: "AttendanceRecord",
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

export const attendanceRecordService = new AttendanceRecordService();
