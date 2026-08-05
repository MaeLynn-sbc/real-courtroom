import type { Prisma, ShiftTemplate } from "@/lib/generated/prisma/client";
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

export interface CreateShiftTemplateInput {
  name: string;
  startTime: string;
  endTime: string;
}

// Payroll Batch 2a: the two seeded shifts (Opening/Closing, see
// prisma/seed.ts's SHIFT_TEMPLATE_DEFINITIONS) cover the facility today —
// this exists so a THIRD template can be added later without a migration.
// No delete method, same "deactivate, never delete" policy as Employee
// (schema.prisma's own comment on Employee.isActive): a past
// ScheduleAssignment.templateId still points at whatever template was
// assigned that day, and deleting the template out from under that
// historical row would either cascade-destroy roster history or violate
// the FK outright. setTemplateActive(false) is the only supported way to
// retire one.
export class ShiftTemplateService {
  async listTemplates(): Promise<ShiftTemplate[]> {
    return prisma.shiftTemplate.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  }

  async createTemplate(
    input: CreateShiftTemplateInput,
    actorUserId: string,
  ): Promise<ShiftTemplate> {
    if (!input.name.trim()) {
      throw new Error("Enter a name for this shift.");
    }

    const template = await prisma.shiftTemplate.create({
      data: { name: input.name.trim(), startTime: input.startTime, endTime: input.endTime },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "shift_template.created",
      entityId: template.id,
      newValues: template,
    });

    return template;
  }

  async setTemplateActive(
    templateId: string,
    active: boolean,
    actorUserId: string,
  ): Promise<ShiftTemplate> {
    const existing = await prisma.shiftTemplate.findUniqueOrThrow({ where: { id: templateId } });

    const template = await prisma.shiftTemplate.update({
      where: { id: templateId },
      data: { active },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "shift_template.active_changed",
      entityId: template.id,
      oldValues: { active: existing.active },
      newValues: { active: template.active },
    });

    return template;
  }

  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: "ShiftTemplate",
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

export const shiftTemplateService = new ShiftTemplateService();
