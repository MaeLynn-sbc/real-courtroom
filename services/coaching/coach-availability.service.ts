import type { CreateAvailabilityWindowInput } from "@/features/coaching/schemas/coaching.schema";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// Distinct from "you don't have the coaching:manage_own_availability
// permission" (an action-layer, requirePermission concern) — this is
// "you have the permission, but this isn't your window." Both are
// required; neither substitutes for the other. See
// coach-availability.ownership.integration.ts.
export class CoachAvailabilityOwnershipError extends Error {
  constructor() {
    super("You can only manage your own coaching availability.");
    this.name = "CoachAvailabilityOwnershipError";
  }
}

export class NotACoachError extends Error {
  constructor() {
    super("This employee isn't marked as a coach.");
    this.name = "NotACoachError";
  }
}

export class CoachAvailabilityService {
  async listWindows(coachId: string) {
    return prisma.coachAvailabilityWindow.findMany({
      where: { coachId },
      orderBy: { startAt: "asc" },
    });
  }

  // "Which of my coaches have a window covering this slot" — the coach
  // picker for a court booking. isCoach + isActive gating happens here,
  // not left to the caller: an employee without isCoach (regardless of
  // permissions) is invisible to this, same as a deactivated employee
  // never appears here either.
  async listAvailableCoaches(slotStart: Date, slotEnd: Date) {
    return prisma.employee.findMany({
      where: {
        isCoach: true,
        isActive: true,
        deletedAt: null,
        coachAvailabilityWindows: {
          some: { startAt: { lte: slotStart }, endAt: { gte: slotEnd } },
        },
      },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
  }

  // Every isCoach=true, active employee — for the availability-management
  // picker (admin choosing whose windows to view), not the booking-time
  // "who's actually free" picker above.
  async listCoaches() {
    return prisma.employee.findMany({
      where: { isCoach: true, isActive: true, deletedAt: null },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
  }

  async createWindow(input: CreateAvailabilityWindowInput, callerEmployeeId: string, actorUserId: string) {
    if (input.coachId !== callerEmployeeId) {
      throw new CoachAvailabilityOwnershipError();
    }

    const coach = await prisma.employee.findUniqueOrThrow({ where: { id: input.coachId } });
    if (!coach.isCoach) {
      throw new NotACoachError();
    }

    const window = await prisma.coachAvailabilityWindow.create({
      data: {
        coachId: input.coachId,
        startAt: input.startAt,
        endAt: input.endAt,
        notes: input.notes,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "coach_availability_window.created",
      entityId: window.id,
      newValues: window,
    });

    return window;
  }

  async deleteWindow(windowId: string, callerEmployeeId: string, actorUserId: string): Promise<void> {
    const window = await prisma.coachAvailabilityWindow.findUniqueOrThrow({ where: { id: windowId } });
    if (window.coachId !== callerEmployeeId) {
      throw new CoachAvailabilityOwnershipError();
    }

    await prisma.coachAvailabilityWindow.delete({ where: { id: windowId } });

    await this.writeAuditLog({
      actorUserId,
      action: "coach_availability_window.deleted",
      entityId: windowId,
      oldValues: window,
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
          entityType: "CoachAvailabilityWindow",
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

export const coachAvailabilityService = new CoachAvailabilityService();
