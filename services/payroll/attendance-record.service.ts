import { computeBusinessDate } from "@/lib/business-date";
import type { AttendanceRecord, Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { settingsService } from "@/services/settings/settings.service";

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

// Payroll Batch 1 closeout (migration 76). The old
// AttendanceRecordAlreadyExistsError is gone with the unique constraint
// it reported: a second shift on the same day is legitimate here (an
// opening AND a closing), so "already exists for this date" was never the
// real invariant. Two records must not cover the same MINUTES — that is.
export class AttendanceRecordOverlapError extends Error {
  constructor() {
    super("This overlaps an attendance record already logged for this employee.");
    this.name = "AttendanceRecordOverlapError";
  }
}

export interface CreateManualAttendanceEntryInput {
  employeeId: string;
  // No workDate. It is DERIVED from clockIn (see deriveWorkDate) rather
  // than taken from whichever calendar date the form happened to show — a
  // 23:00-01:00 shift belongs to the night it started, and asking the form
  // to know that put a business-date rule in the UI.
  clockIn: Date;
  clockOut?: Date | null;
}

export interface CorrectAttendanceEntryInput {
  recordId: string;
  clockIn: Date;
  clockOut?: Date | null;
  reason: string;
}

// Enforced HERE, not only in the Zod schema the two server actions happen
// to call — a script, a seed or a future batch reaching the service
// directly could otherwise persist a negative shift, which payroll would
// compute as negative worked minutes. Migration 76 adds the same rule as a
// DB CHECK, so it now holds at all three layers.
function assertClockOutAfterClockIn(clockIn: Date, clockOut?: Date | null): void {
  if (clockOut && clockOut.getTime() <= clockIn.getTime()) {
    throw new Error("Clock out must be after clock in.");
  }
}

// Payroll Batch 1 — manual entry only. No live-seeding from Shift yet
// (source is always MANUAL here; LIVE is wired in a later batch), no
// rate/hours computation (that's the computation-engine batch). See
// AttendanceRecord's own schema comment for the full list of fields
// deliberately not touched by this batch.
export class AttendanceRecordService {
  // The business day a shift belongs to, from when it STARTED — the same
  // rollover-hour rule the rest of the app uses (lib/business-date.ts),
  // not a raw calendar cast. With the production default of 3, a 01:00
  // clock-in still belongs to the previous night; a 04:00 one does not.
  private async deriveWorkDate(clockIn: Date): Promise<Date> {
    const { businessDateRolloverHour } = await settingsService.getCourtHours();
    return computeBusinessDate(clockIn, businessDateRolloverHour);
  }

  // Two records covering the same minutes are the real conflict. Windows
  // are half-open: a shift starting exactly when another ended abuts, it
  // does not overlap. An open record (no clock-out yet) is treated as a
  // zero-length window at its clock-in, so it still blocks a shift that
  // would swallow it without pretending it runs forever.
  //
  // Candidates are fetched by workDate across the adjacent days rather
  // than by timestamp, because an overnight record's clockOut lands on the
  // day AFTER its own workDate. It's one employee's handful of rows, so
  // the filtering is done in memory where the half-open rule is legible.
  private async assertNoOverlap(
    employeeId: string,
    clockIn: Date,
    clockOut: Date | null | undefined,
    workDate: Date,
    excludeRecordId?: string,
  ): Promise<void> {
    const windowStart = new Date(workDate.getFullYear(), workDate.getMonth(), workDate.getDate() - 1);
    const windowEnd = new Date(workDate.getFullYear(), workDate.getMonth(), workDate.getDate() + 1);

    const candidates = await prisma.attendanceRecord.findMany({
      where: {
        employeeId,
        workDate: { gte: windowStart, lte: windowEnd },
        ...(excludeRecordId ? { id: { not: excludeRecordId } } : {}),
      },
    });

    const newStart = clockIn.getTime();
    const newEnd = (clockOut ?? clockIn).getTime();

    const clash = candidates.some((existing) => {
      const existingStart = existing.clockIn.getTime();
      const existingEnd = (existing.clockOut ?? existing.clockIn).getTime();
      return newStart < existingEnd && existingStart < newEnd;
    });

    if (clash) {
      throw new AttendanceRecordOverlapError();
    }
  }

  // rawClockIn/rawClockOut are captured from clockIn/clockOut at THIS
  // moment, once, and never written again by correctEntry below — the
  // whole point of "raw" is that it survives every later correction
  // unchanged, so a corrected record still shows what was originally
  // entered.
  async createManualEntry(
    input: CreateManualAttendanceEntryInput,
    actorUserId: string,
  ): Promise<AttendanceRecord> {
    assertClockOutAfterClockIn(input.clockIn, input.clockOut);

    const workDate = await this.deriveWorkDate(input.clockIn);
    await this.assertNoOverlap(input.employeeId, input.clockIn, input.clockOut, workDate);

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

  // Closes the seam AttendanceRecord's own schema comment left open
  // ("shiftId is the seam for a later batch to wire..."), and the
  // AttendanceSource.LIVE value that until now nothing produced.
  //
  // Owner incident (2026-08-26): payroll showed PHP 0.00 and
  // NO_ATTENDANCE for every day from Aug 15 onward, and the owner was
  // certain staff had been there. They had. 22 closed Shift rows carried
  // their real times all along — Dani Ace 07:40-15:19 on the 17th, and so
  // on — while AttendanceRecord had not been written to since a one-off
  // backfill on Aug 14. Two tables recording the same human fact, only
  // one of them wired to pay.
  //
  // Manual entry was never going to hold: it is a separate daily chore
  // nobody is reminded of, and its absence is invisible until payroll
  // runs weeks later. Seeding from the shift makes attendance a
  // by-product of work staff already do every day.
  //
  // The separation the schema insists on survives. This writes a NEW
  // AttendanceRecord rather than reading Shift at payroll time, so
  // correcting a clock time still cannot rewrite a cash-custody fact, and
  // rawClockIn/rawClockOut preserve what the shift originally said even
  // after a correction.
  //
  // Returns null rather than throwing on every "nothing to do" case —
  // callers include endShift, where failing to seed attendance must never
  // block a cash-custody close.
  async seedFromShift(
    shift: { id: string; employeeId: string; startedAt: Date; endedAt: Date | null },
    actorUserId: string,
  ): Promise<AttendanceRecord | null> {
    if (!shift.endedAt) {
      return null;
    }
    if (shift.endedAt.getTime() <= shift.startedAt.getTime()) {
      logger.warn(
        { shiftId: shift.id },
        "Not seeding attendance: the shift ended at or before it started",
      );
      return null;
    }

    // Idempotent on the shift, so a re-run or a retry cannot duplicate.
    const already = await prisma.attendanceRecord.findFirst({ where: { shiftId: shift.id } });
    if (already) {
      return null;
    }

    const workDate = await this.deriveWorkDate(shift.startedAt);

    // A manually-entered record for the same hours already covers this —
    // skip rather than throw, and leave the human's entry authoritative.
    try {
      await this.assertNoOverlap(shift.employeeId, shift.startedAt, shift.endedAt, workDate);
    } catch {
      logger.info(
        { shiftId: shift.id, employeeId: shift.employeeId },
        "Not seeding attendance: an existing record already covers these hours",
      );
      return null;
    }

    const record = await prisma.attendanceRecord.create({
      data: {
        employeeId: shift.employeeId,
        workDate,
        clockIn: shift.startedAt,
        clockOut: shift.endedAt,
        rawClockIn: shift.startedAt,
        rawClockOut: shift.endedAt,
        source: "LIVE",
        shiftId: shift.id,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "attendance_record.seeded_from_shift",
      entityId: record.id,
      newValues: record,
    });

    return record;
  }

  // Required reason, same "who/when/why" shape as GcashDailyBalance's
  // overrideStartingBalance and TimeLogEntry's own correction fields —
  // updates clockIn/clockOut (the payroll-editable value) but never
  // touches rawClockIn/rawClockOut.
  //
  // workDate is RE-DERIVED: correcting a clock-in from 23:50 to 00:10 moves
  // which night the shift belongs to, and leaving the old workDate behind
  // would file it against a day it no longer touches.
  async correctEntry(
    input: CorrectAttendanceEntryInput,
    actorUserId: string,
  ): Promise<AttendanceRecord> {
    if (!input.reason.trim()) {
      throw new Error("A reason is required to correct an attendance record.");
    }
    assertClockOutAfterClockIn(input.clockIn, input.clockOut);

    const existing = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { id: input.recordId },
    });

    const workDate = await this.deriveWorkDate(input.clockIn);
    await this.assertNoOverlap(
      existing.employeeId,
      input.clockIn,
      input.clockOut,
      workDate,
      existing.id,
    );

    const record = await prisma.attendanceRecord.update({
      where: { id: input.recordId },
      data: {
        workDate,
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
      orderBy: [{ workDate: "desc" }, { clockIn: "asc" }],
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
