import type { CreateAvailabilityWindowInput } from "@/features/coaching/schemas/coaching.schema";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// Part B (post-Gate-3 review): the two active coaches are family
// (father/son) who coordinate schedules directly, and the non-coach
// owner routinely inputs a slot on a coach's behalf ("put me in this
// time"). Strict per-coach ownership is friction neither of those
// scenarios needs right now — so it's relaxed, but through exactly ONE
// switch, not scattered permission changes, specifically so it's cheap
// to reverse. Flip this back to false the moment a non-family coach
// joins and calendar isolation actually matters — nothing else in this
// file needs to change to do that. Reasoning also recorded in
// BUILD-SPEC.md §15 so it isn't just a comment nobody finds later.
//
// What this does NOT relax: the caller must still hold
// coaching:manage_own_availability (an action-layer, requirePermission
// concern, unaffected by this flag) and the TARGET employee must still
// be isCoach — this only widens "whose calendar," never "who can reach
// this at all" or "can you edit a non-coach's calendar."
const ALLOW_CROSS_COACH_AVAILABILITY_EDITS = true;

// Distinct from "you don't have the coaching:manage_own_availability
// permission" (an action-layer, requirePermission concern) — this is
// "you have the permission, but this isn't your window" — only
// reachable when ALLOW_CROSS_COACH_AVAILABILITY_EDITS is false. Both
// checks are required when active; neither substitutes for the other.
// See coach-availability-ownership.integration.ts.
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
    const editingOwnCalendar = input.coachId === callerEmployeeId;
    if (!editingOwnCalendar && !ALLOW_CROSS_COACH_AVAILABILITY_EDITS) {
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

    // Part B traceability (item 4): a cross-coach or admin-on-behalf-of
    // edit is recorded as one explicitly, not indistinguishable from a
    // coach managing their own calendar — "silently becomes normal" is
    // exactly what this metadata prevents, since it's queryable later.
    await this.writeAuditLog({
      actorUserId,
      action: "coach_availability_window.created",
      entityId: window.id,
      newValues: window,
      metadata: { callerEmployeeId, editingOwnCalendar },
    });

    return window;
  }

  async deleteWindow(windowId: string, callerEmployeeId: string, actorUserId: string): Promise<void> {
    const window = await prisma.coachAvailabilityWindow.findUniqueOrThrow({ where: { id: windowId } });
    const editingOwnCalendar = window.coachId === callerEmployeeId;
    if (!editingOwnCalendar && !ALLOW_CROSS_COACH_AVAILABILITY_EDITS) {
      throw new CoachAvailabilityOwnershipError();
    }

    await prisma.coachAvailabilityWindow.delete({ where: { id: windowId } });

    await this.writeAuditLog({
      actorUserId,
      action: "coach_availability_window.deleted",
      entityId: windowId,
      oldValues: window,
      metadata: { callerEmployeeId, editingOwnCalendar },
    });
  }

  private async writeAuditLog(entry: {
    actorUserId: string;
    action: string;
    entityId: string;
    oldValues?: unknown;
    newValues?: unknown;
    metadata?: unknown;
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
          metadata: entry.metadata ? (JSON.parse(JSON.stringify(entry.metadata)) as object) : undefined,
        },
      });
    } catch (error) {
      logger.error({ err: error, action: entry.action }, "Failed to write audit log entry");
    }
  }
}

export const coachAvailabilityService = new CoachAvailabilityService();
