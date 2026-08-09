import type {
  CreateCourtInput,
  CourtMaintenanceInput,
  SpecialEventInput,
  UpdateCourtInput,
} from "@/features/courts/schemas/court.schema";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { Court, CourtMaintenance, Prisma } from "@/lib/generated/prisma/client";
import type { CourtStatus, MaintenanceStatus } from "@/lib/generated/prisma/enums";
import { isWithinMaintenanceWindow, type CourtAvailability } from "@/services/court/court-availability";

export type { CourtAvailability } from "@/services/court/court-availability";

export type CourtStatusSnapshotEntry = {
  id: string;
  name: string;
  state: "AVAILABLE" | "OCCUPIED" | "MAINTENANCE" | "DISABLED";
};

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  // Round-trips through JSON so Dates/etc. become JSON-safe before Prisma
  // stores them in a Json column.
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

export class CourtService {
  async listCourts(): Promise<Court[]> {
    return prisma.court.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
    });
  }

  async getCourtById(
    courtId: string,
  ): Promise<(Court & { maintenanceRecords: CourtMaintenance[] }) | null> {
    return prisma.court.findUnique({
      where: { id: courtId },
      include: {
        maintenanceRecords: { orderBy: { startAt: "desc" } },
      },
    });
  }

  async createCourt(input: CreateCourtInput, actorUserId: string): Promise<Court> {
    const court = await prisma.court.create({
      data: {
        name: input.name,
        description: input.description,
        indoor: input.indoor,
        hourlyRateCents: input.hourlyRateCents,
        shortSessionPriceCents: input.shortSessionPriceCents,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "court.created",
      entityType: "Court",
      entityId: court.id,
      newValues: court,
    });

    return court;
  }

  async updateCourt(
    courtId: string,
    input: UpdateCourtInput,
    actorUserId: string,
  ): Promise<Court> {
    const existing = await prisma.court.findUniqueOrThrow({ where: { id: courtId } });

    const court = await prisma.court.update({
      where: { id: courtId },
      data: {
        name: input.name,
        description: input.description,
        indoor: input.indoor,
        hourlyRateCents: input.hourlyRateCents,
        shortSessionPriceCents: input.shortSessionPriceCents,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "court.updated",
      entityType: "Court",
      entityId: court.id,
      oldValues: existing,
      newValues: court,
    });

    return court;
  }

  async setCourtStatus(
    courtId: string,
    status: CourtStatus,
    actorUserId: string,
  ): Promise<Court> {
    const existing = await prisma.court.findUniqueOrThrow({ where: { id: courtId } });

    const court = await prisma.court.update({
      where: { id: courtId },
      data: { status },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "court.status_changed",
      entityType: "Court",
      entityId: court.id,
      oldValues: { status: existing.status },
      newValues: { status: court.status },
    });

    return court;
  }

  async scheduleMaintenance(
    courtId: string,
    input: CourtMaintenanceInput,
    actorUserId: string,
  ): Promise<CourtMaintenance> {
    const maintenance = await prisma.courtMaintenance.create({
      data: {
        courtId,
        createdById: actorUserId,
        reason: input.reason,
        notes: input.notes,
        startAt: input.startAt,
        endAt: input.endAt,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "court.maintenance_scheduled",
      entityType: "CourtMaintenance",
      entityId: maintenance.id,
      newValues: maintenance,
    });

    return maintenance;
  }

  // Owner request (2026-08-08): "block courts for a special event" —
  // one CourtMaintenance row per selected court, kind: SPECIAL_EVENT,
  // sharing the same reason/notes/window. Reuses every existing
  // conflict-detection path (checkAvailabilityWithClient,
  // listOccupiedWindows, getPublicDaySchedule, getStaffDaySchedule) —
  // see CourtBlockKind's own schema comment for why this is an
  // extension of maintenance, not a new model. $transaction so a
  // failure partway through (e.g. a bad courtId) leaves zero rows
  // behind, not a partially-blocked event.
  async scheduleSpecialEvent(
    input: SpecialEventInput,
    actorUserId: string,
  ): Promise<CourtMaintenance[]> {
    const records = await prisma.$transaction(
      input.courtIds.map((courtId) =>
        prisma.courtMaintenance.create({
          data: {
            courtId,
            createdById: actorUserId,
            reason: input.reason,
            notes: input.notes,
            startAt: input.startAt,
            endAt: input.endAt,
            kind: "SPECIAL_EVENT",
          },
        }),
      ),
    );

    await Promise.all(
      records.map((record) =>
        this.writeAuditLog({
          actorUserId,
          action: "court.special_event_scheduled",
          entityType: "CourtMaintenance",
          entityId: record.id,
          newValues: record,
        }),
      ),
    );

    return records;
  }

  // Global list across every court — unlike maintenance, which is only
  // ever browsed per-court from that court's own detail page, special
  // events need their own dedicated admin page (multiple courts, one
  // event) with a full upcoming/past list.
  async listSpecialEvents(limit = 50): Promise<(CourtMaintenance & { court: { name: string } })[]> {
    return prisma.courtMaintenance.findMany({
      where: { kind: "SPECIAL_EVENT" },
      include: { court: { select: { name: true } } },
      orderBy: { startAt: "desc" },
      take: limit,
    });
  }

  // Owner request (2026-08-09): "u can edit the time and date if the
  // organizers change their minds" — edits ONE row's window (courtId,
  // reason, notes, kind untouched). A multi-court event that needs its
  // whole window moved means one edit per court's row, same as
  // cancelling is already per-row.
  async updateSpecialEventTiming(
    maintenanceId: string,
    startAt: Date,
    endAt: Date,
    actorUserId: string,
  ): Promise<CourtMaintenance> {
    const existing = await prisma.courtMaintenance.findUniqueOrThrow({
      where: { id: maintenanceId },
    });

    const updated = await prisma.courtMaintenance.update({
      where: { id: maintenanceId },
      data: { startAt, endAt },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "court.special_event_timing_updated",
      entityType: "CourtMaintenance",
      entityId: updated.id,
      oldValues: { startAt: existing.startAt, endAt: existing.endAt },
      newValues: { startAt: updated.startAt, endAt: updated.endAt },
    });

    return updated;
  }

  // Owner request (2026-08-09): "i want an option to delete cancelled
  // events" — a real delete, not another status. Guarded to CANCELLED
  // rows only: an active/scheduled block still enforces real
  // availability checks (checkAvailabilityWithClient), so deleting one
  // of those out from under a live block would silently reopen a court
  // someone thinks is closed. A cancelled row already blocks nothing —
  // deleting it is pure cleanup.
  async deleteSpecialEvent(maintenanceId: string, actorUserId: string): Promise<void> {
    const existing = await prisma.courtMaintenance.findUniqueOrThrow({
      where: { id: maintenanceId },
    });
    if (existing.status !== "CANCELLED") {
      throw new Error("Only a cancelled event can be deleted — cancel it first.");
    }

    await prisma.courtMaintenance.delete({ where: { id: maintenanceId } });

    await this.writeAuditLog({
      actorUserId,
      action: "court.special_event_deleted",
      entityType: "CourtMaintenance",
      entityId: maintenanceId,
      oldValues: existing,
    });
  }

  async updateMaintenanceStatus(
    maintenanceId: string,
    status: MaintenanceStatus,
    actorUserId: string,
  ): Promise<CourtMaintenance> {
    const existing = await prisma.courtMaintenance.findUniqueOrThrow({
      where: { id: maintenanceId },
    });

    const maintenance = await prisma.courtMaintenance.update({
      where: { id: maintenanceId },
      data: { status },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "court.maintenance_status_changed",
      entityType: "CourtMaintenance",
      entityId: maintenance.id,
      oldValues: { status: existing.status },
      newValues: { status: maintenance.status },
    });

    return maintenance;
  }

  // v1.1 Sub-phase 5: dashboard-only Court Status panel. Deliberately just
  // two queries total regardless of court count — not N calls to
  // getCurrentAvailability/checkAvailability — since this renders on every
  // dashboard load. Skips the maintenance-window check that
  // getCurrentAvailability does (a court manually left ACTIVE with a
  // pending maintenance window is rare and not worth a 3rd query here);
  // MAINTENANCE/DISABLED are read straight off the court's own status.
  async getCourtStatusSnapshot(): Promise<CourtStatusSnapshotEntry[]> {
    const courts = await prisma.court.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true },
    });

    const now = new Date();
    const activeCourtIds = courts.filter((court) => court.status === "ACTIVE").map((court) => court.id);

    const occupiedBookings =
      activeCourtIds.length > 0
        ? await prisma.booking.findMany({
            where: {
              courtId: { in: activeCourtIds },
              status: { notIn: ["CANCELLED", "NO_SHOW"] },
              startAt: { lte: now },
              endAt: { gt: now },
            },
            select: { courtId: true },
          })
        : [];
    const occupiedCourtIds = new Set(occupiedBookings.map((booking) => booking.courtId));

    return courts.map((court) => {
      if (court.status === "DISABLED") {
        return { id: court.id, name: court.name, state: "DISABLED" as const };
      }
      if (court.status === "MAINTENANCE") {
        return { id: court.id, name: court.name, state: "MAINTENANCE" as const };
      }
      return {
        id: court.id,
        name: court.name,
        state: occupiedCourtIds.has(court.id) ? ("OCCUPIED" as const) : ("AVAILABLE" as const),
      };
    });
  }

  async getCurrentAvailability(courtId: string): Promise<CourtAvailability> {
    const court = await prisma.court.findUniqueOrThrow({ where: { id: courtId } });

    if (court.status === "DISABLED") {
      return "DISABLED";
    }

    if (court.status === "MAINTENANCE") {
      return "UNDER_MAINTENANCE";
    }

    const activeWindows = await prisma.courtMaintenance.findMany({
      where: { courtId, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
      select: { startAt: true, endAt: true, status: true },
    });

    return isWithinMaintenanceWindow(new Date(), activeWindows) ? "UNDER_MAINTENANCE" : "AVAILABLE";
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
      // Audit logging must never block the primary operation from succeeding.
      logger.error(
        { err: error, action: entry.action, userId: entry.actorUserId },
        "Failed to write audit log entry",
      );
    }
  }
}

export const courtService = new CourtService();
