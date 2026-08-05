import type { EmployeeRate, Prisma } from "@/lib/generated/prisma/client";
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

export interface CreateEmployeeRateInput {
  employeeId: string;
  dailyRateCents: number;
  effectiveFrom: Date;
  note?: string;
}

// Payroll Batch 2b. Deliberately NOT modeled like CoachRate (flat,
// overwrite-in-place) — see the schema comment on EmployeeRate for why. A
// new row is always inserted; an existing row is never edited or
// overwritten in place. deleteLatestRate is the one exception to "never
// delete," and only for the single row where deleting can't retroactively
// change what any other day resolves to.
export class EmployeeRateService {
  async listRateHistory(employeeId: string): Promise<EmployeeRate[]> {
    return prisma.employeeRate.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: "desc" },
    });
  }

  // "What rate applied on day Y" — the most recent row with
  // effectiveFrom <= that day. null means no rate was ever set as of that
  // date; callers must treat that as a visible exception (Batch 2c's
  // NO_RATE_IN_EFFECT), never default it to 0.
  async resolveRateForDate(employeeId: string, workDate: Date): Promise<EmployeeRate | null> {
    return prisma.employeeRate.findFirst({
      where: { employeeId, effectiveFrom: { lte: toMidnight(workDate) } },
      orderBy: { effectiveFrom: "desc" },
    });
  }

  async createRate(input: CreateEmployeeRateInput, actorUserId: string): Promise<EmployeeRate> {
    if (input.dailyRateCents <= 0) {
      throw new Error("The daily rate must be greater than zero.");
    }

    const rate = await prisma.employeeRate.create({
      data: {
        employeeId: input.employeeId,
        dailyRateCents: input.dailyRateCents,
        effectiveFrom: toMidnight(input.effectiveFrom),
        note: input.note?.trim() || null,
        createdByUserId: actorUserId,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "employee_rate.created",
      entityId: rate.id,
      newValues: rate,
    });

    return rate;
  }

  // Only the most-recent (max effectiveFrom) row for the employee can be
  // deleted. Deleting a mid-history row would silently change what every
  // day between it and the next-most-recent row resolves to — exactly the
  // kind of retroactive change EmployeeRate exists to prevent — so that's
  // rejected outright rather than "handled."
  async deleteLatestRate(rateId: string, actorUserId: string): Promise<void> {
    const target = await prisma.employeeRate.findUniqueOrThrow({ where: { id: rateId } });

    const mostRecent = await prisma.employeeRate.findFirst({
      where: { employeeId: target.employeeId },
      orderBy: { effectiveFrom: "desc" },
    });

    if (mostRecent?.id !== target.id) {
      throw new Error(
        "Only the most recent rate for this employee can be deleted — deleting an older rate would change pay on days that already relied on it.",
      );
    }

    await prisma.employeeRate.delete({ where: { id: rateId } });

    await this.writeAuditLog({
      actorUserId,
      action: "employee_rate.deleted",
      entityId: target.id,
      oldValues: target,
    });
  }

  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: "EmployeeRate",
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

export const employeeRateService = new EmployeeRateService();
