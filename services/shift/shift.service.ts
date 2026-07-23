import type { EndShiftInput, StartShiftInput } from "@/features/shifts/schemas/shift.schema";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
import { formatShiftNumber } from "@/services/shift/shift-number";

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

interface AuditLogEntry {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

export class ShiftAlreadyOpenError extends Error {
  constructor() {
    super("This employee already has an open shift. End it before starting a new one.");
    this.name = "ShiftAlreadyOpenError";
  }
}

export class ShiftService {
  async getCurrentShift(employeeId: string) {
    return prisma.shift.findFirst({
      where: { employeeId, status: "OPEN" },
      orderBy: { startedAt: "desc" },
    });
  }

  async listShifts(employeeId: string, limit = 10) {
    return prisma.shift.findMany({
      where: { employeeId },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  // "Only one OPEN shift per employee" is enforced here (checked fresh
  // before creating) — multiple CLOSED shifts on the same day are fine.
  // v1.1 maintenance: shiftNumber now comes from the shared atomic
  // counter (lib/reference-counter.ts), so it can no longer collide —
  // the retry loop this used to need solely for that is gone.
  async startShift(employeeId: string, input: StartShiftInput, actorUserId: string) {
    const existingOpen = await this.getCurrentShift(employeeId);
    if (existingOpen) {
      throw new ShiftAlreadyOpenError();
    }

    const now = new Date();
    const sequence = await nextSequence(dailyScope("SHIFT", now));
    const shiftNumber = formatShiftNumber(now, sequence);

    const shift = await prisma.shift.create({
      data: {
        shiftNumber,
        employeeId,
        openingCashCents: input.openingCashCents,
        openingNotes: input.openingNotes,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "shift.started",
      entityType: "Shift",
      entityId: shift.id,
      newValues: shift,
    });

    return shift;
  }

  // varianceCents stays null here — no Sale model exists yet to sum cash
  // sales against (v1.1 Sub-phase 2 wires this in).
  async endShift(shiftId: string, input: EndShiftInput, actorUserId: string) {
    const existing = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });

    if (existing.status !== "OPEN") {
      throw new Error("This shift is already closed.");
    }

    const shift = await prisma.shift.update({
      where: { id: shiftId },
      data: {
        status: "CLOSED",
        closingCashCents: input.closingCashCents,
        closingNotes: input.closingNotes,
        endedAt: new Date(),
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "shift.ended",
      entityType: "Shift",
      entityId: shift.id,
      oldValues: existing,
      newValues: shift,
    });

    return shift;
  }

  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          oldValues: toJsonValue(entry.oldValues),
          newValues: toJsonValue(entry.newValues),
        },
      });
    } catch (error) {
      logger.error(
        { err: error, action: entry.action, userId: entry.actorUserId },
        "Failed to write audit log entry",
      );
    }
  }
}

export const shiftService = new ShiftService();
