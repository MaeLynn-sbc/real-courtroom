import type {
  CopyWeekAvailabilityInput,
  CreateAvailabilityWindowInput,
  SetDayAvailabilityInput,
} from "@/features/coaching/schemas/coaching.schema";
import { expandWindowToHours, mergeHoursIntoWindows } from "@/lib/hour-windows";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// Local calendar-day boundaries (midnight to midnight) — deliberately
// NOT lib/business-date.ts's business-date rollover (that's for
// grouping sales/reporting around a 3AM cutover, an unrelated concept).
// A coach's "Tuesday" is the calendar day, matching how the week-strip
// UI and every other date-only value in this file already thinks about
// dates. Local Date getters, never toISOString() — this session's own
// long-standing Asia/Manila date-shifting pitfall.
function dayRange(date: Date): { startOfDay: Date; endOfDay: Date } {
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);
  return { startOfDay, endOfDay };
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

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

// Shared by every write path below (createWindow, setDayAvailability,
// copyWeekAvailability) — the exact ownership + isCoach check, in one
// place, so a future change to either rule can't drift between them.
// Returns editingOwnCalendar for the caller's own audit-log metadata.
async function assertCanEditCoach(
  coachId: string,
  callerEmployeeId: string,
): Promise<{ editingOwnCalendar: boolean }> {
  const editingOwnCalendar = coachId === callerEmployeeId;
  if (!editingOwnCalendar && !ALLOW_CROSS_COACH_AVAILABILITY_EDITS) {
    throw new CoachAvailabilityOwnershipError();
  }

  const coach = await prisma.employee.findUniqueOrThrow({ where: { id: coachId } });
  if (!coach.isCoach) {
    throw new NotACoachError();
  }

  return { editingOwnCalendar };
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
  //
  // Found live: a coach already double-booked for the requested slot
  // (a real, active CoachSession overlapping it) was still offered here,
  // since this only ever checked the coach's STATED calendar window, not
  // their actual existing sessions — createCoachSession's own
  // COACH_DOUBLE_BOOKED guard catches it, but only after a booking has
  // already been created around them (both the staff picker's two-step
  // submit and the public confirmation screen's add-coach step create
  // the booking first). Confirmed against real rows: a coach with a
  // session already occupying the slot was returned here, then rejected
  // by createCoachSession when actually attached. Same overlap rule as
  // that guard (notIn CANCELLED/NO_SHOW on the session, notIn
  // CANCELLED/NO_SHOW/REJECTED on its booking, an expired
  // AWAITING_PAYMENT hold treated as if it doesn't exist) — duplicated,
  // not shared, same precedent as every other copy of this exact
  // where-clause in this codebase.
  async listAvailableCoaches(slotStart: Date, slotEnd: Date) {
    const now = new Date();
    return prisma.employee.findMany({
      where: {
        isCoach: true,
        isActive: true,
        deletedAt: null,
        coachAvailabilityWindows: {
          some: { startAt: { lte: slotStart }, endAt: { gte: slotEnd } },
        },
        coachSessions: {
          none: {
            status: { notIn: ["CANCELLED", "NO_SHOW"] },
            booking: {
              status: { notIn: ["CANCELLED", "NO_SHOW", "REJECTED"] },
              OR: [{ status: { not: "AWAITING_PAYMENT" } }, { holdExpiresAt: null }, { holdExpiresAt: { gte: now } }],
              startAt: { lt: slotEnd },
              endAt: { gt: slotStart },
            },
          },
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
    const { editingOwnCalendar } = await assertCanEditCoach(input.coachId, callerEmployeeId);

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

  // The week-grid UI's one write path: "here is the complete set of
  // whole hours this coach is available on this calendar day" —
  // reconciled against whatever's currently stored, not appended to it.
  // Replaces the day's windows wholesale (delete then recreate) rather
  // than diffing individual rows; at the volume one coach's one day
  // ever holds (a handful of windows, if that) this is simpler and
  // exactly as correct as an incremental diff, and it's what makes
  // "contiguous hours become one row" trivial — mergeHoursIntoWindows
  // just recomputes the minimal set fresh every time instead of trying
  // to grow/shrink/split existing rows in place.
  async setDayAvailability(
    input: SetDayAvailabilityInput,
    callerEmployeeId: string,
    actorUserId: string,
  ): Promise<{ id: string; startAt: Date; endAt: Date }[]> {
    const { editingOwnCalendar } = await assertCanEditCoach(input.coachId, callerEmployeeId);

    const { startOfDay, endOfDay } = dayRange(input.date);

    const { existingHours, created } = await prisma.$transaction(async (tx) => {
      const existing = await tx.coachAvailabilityWindow.findMany({
        where: { coachId: input.coachId, startAt: { gte: startOfDay, lt: endOfDay } },
      });

      if (existing.length > 0) {
        await tx.coachAvailabilityWindow.deleteMany({
          where: { id: { in: existing.map((window) => window.id) } },
        });
      }

      const mergedWindows = mergeHoursIntoWindows(input.hours);
      const createdRows = await Promise.all(
        mergedWindows.map((window) =>
          tx.coachAvailabilityWindow.create({
            data: {
              coachId: input.coachId,
              startAt: new Date(
                startOfDay.getFullYear(),
                startOfDay.getMonth(),
                startOfDay.getDate(),
                window.startHour,
              ),
              endAt: new Date(
                startOfDay.getFullYear(),
                startOfDay.getMonth(),
                startOfDay.getDate(),
                window.endHour,
              ),
            },
          }),
        ),
      );

      const existingHoursFlat = existing.flatMap((window) =>
        expandWindowToHours({
          startHour: window.startAt.getHours(),
          endHour: window.endAt.getHours(),
        }),
      );

      return { existingHours: existingHoursFlat, created: createdRows };
    });

    await this.writeAuditLog({
      actorUserId,
      action: "coach_availability_window.day_set",
      entityId: input.coachId,
      oldValues: { date: startOfDay, hours: existingHours },
      newValues: { date: startOfDay, hours: input.hours },
      metadata: { callerEmployeeId, editingOwnCalendar },
    });

    return created;
  }

  // "Copy last week" — makes the target week's 7 days an exact mirror
  // of the 7 days immediately before it, day-for-day (Tuesday copies
  // from the previous Tuesday, etc.), including clearing a target day
  // that has no counterpart in the source week. Idempotent: running it
  // twice in a row leaves the same result, since each day is a wholesale
  // replace (same reconciliation setDayAvailability uses), not an
  // additive copy that would pile up duplicate windows on a second run.
  async copyWeekAvailability(
    input: CopyWeekAvailabilityInput,
    callerEmployeeId: string,
    actorUserId: string,
  ): Promise<void> {
    await assertCanEditCoach(input.coachId, callerEmployeeId);

    const targetWeekStart = dayRange(input.weekStart).startOfDay;
    const sourceWeekStart = addDays(targetWeekStart, -7);
    const sourceWeekEnd = addDays(sourceWeekStart, 7);

    const sourceWindows = await prisma.coachAvailabilityWindow.findMany({
      where: { coachId: input.coachId, startAt: { gte: sourceWeekStart, lt: sourceWeekEnd } },
      orderBy: { startAt: "asc" },
    });

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const sourceDay = addDays(sourceWeekStart, dayOffset);
      const targetDay = addDays(targetWeekStart, dayOffset);

      const hoursForDay = sourceWindows
        .filter((window) => window.startAt.getFullYear() === sourceDay.getFullYear()
          && window.startAt.getMonth() === sourceDay.getMonth()
          && window.startAt.getDate() === sourceDay.getDate())
        .flatMap((window) =>
          expandWindowToHours({ startHour: window.startAt.getHours(), endHour: window.endAt.getHours() }),
        );

      // Every day gets set, including an empty array for a day with no
      // source windows — that's what makes the target week a true
      // mirror rather than a leftover mix of old and copied data.
      await this.setDayAvailability(
        { coachId: input.coachId, date: targetDay, hours: hoursForDay },
        callerEmployeeId,
        actorUserId,
      );
    }
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
