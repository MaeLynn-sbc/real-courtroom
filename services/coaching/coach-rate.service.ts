import type { UpsertCoachRateInput } from "@/features/coaching/schemas/coaching.schema";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { NotACoachError } from "@/services/coaching/coach-availability.service";

// No ownership scoping here, unlike CoachAvailabilityService — rate-table
// edits are owner-level (coaching:manage_rates, gated the same tier as
// every other CMS/rates setting), not "each coach sets their own price."
// An Owner/Manager can edit any coach's rate table.
export class CoachRateService {
  async listRates(coachId: string) {
    return prisma.coachRate.findMany({
      where: { coachId },
      orderBy: { groupSize: "asc" },
    });
  }

  async resolveRate(coachId: string, groupSize: number): Promise<number | null> {
    const rate = await prisma.coachRate.findUnique({
      where: { coachId_groupSize: { coachId, groupSize } },
    });
    return rate?.priceCents ?? null;
  }

  async upsertRate(input: UpsertCoachRateInput, actorUserId: string) {
    const coach = await prisma.employee.findUniqueOrThrow({ where: { id: input.coachId } });
    if (!coach.isCoach) {
      throw new NotACoachError();
    }

    const existing = await prisma.coachRate.findUnique({
      where: { coachId_groupSize: { coachId: input.coachId, groupSize: input.groupSize } },
    });

    const rate = await prisma.coachRate.upsert({
      where: { coachId_groupSize: { coachId: input.coachId, groupSize: input.groupSize } },
      create: { coachId: input.coachId, groupSize: input.groupSize, priceCents: input.priceCents },
      update: { priceCents: input.priceCents },
    });

    await this.writeAuditLog({
      actorUserId,
      action: existing ? "coach_rate.updated" : "coach_rate.created",
      entityId: rate.id,
      oldValues: existing,
      newValues: rate,
    });

    return rate;
  }

  async deleteRate(rateId: string, actorUserId: string): Promise<void> {
    const rate = await prisma.coachRate.findUniqueOrThrow({ where: { id: rateId } });
    await prisma.coachRate.delete({ where: { id: rateId } });

    await this.writeAuditLog({
      actorUserId,
      action: "coach_rate.deleted",
      entityId: rateId,
      oldValues: rate,
    });
  }

  private async writeAuditLog(entry: {
    actorUserId: string;
    action: string;
    entityId: string;
    oldValues?: unknown;
    newValues?: unknown;
  }): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: "CoachRate",
          entityId: entry.entityId,
          oldValues: entry.oldValues ? (JSON.parse(JSON.stringify(entry.oldValues)) as object) : undefined,
          newValues: entry.newValues ? (JSON.parse(JSON.stringify(entry.newValues)) as object) : undefined,
        },
      });
    } catch (error) {
      logger.error({ err: error, action: entry.action }, "Failed to write audit log entry");
    }
  }
}

export const coachRateService = new CoachRateService();
