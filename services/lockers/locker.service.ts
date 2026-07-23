import type {
  CreateLockerInput,
  LogMaintenanceInput,
  ResolveMaintenanceInput,
  UpdateLockerInput,
} from "@/features/lockers/schemas/locker.schema";
import type { Locker, LockerMaintenanceLog, Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  calculateLockerDisplayStatus,
  type LockerDisplayStatus,
} from "@/services/lockers/locker-status";
import { mergeTimelineEvents, type LockerTimelineEvent } from "@/services/lockers/locker-timeline";

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

export interface LockerWithComputed extends Locker {
  displayStatus: LockerDisplayStatus;
}

export interface LockerInventorySummary {
  availableCount: number;
  occupiedCount: number;
  maintenanceCount: number;
  reservedCount: number;
}

// Locker has no deletedAt (unlike Player/Team/Court) — DISABLED is the
// functional equivalent of a soft delete.
export class LockerService {
  // Phase 10: batched, not per-item — see equipment.service.ts's
  // listEquipment for the same fix applied there. One query for the
  // lockers, one for every ACTIVE rental across all of them, grouped by
  // lockerId in memory, instead of one rental query per locker.
  async listLockers(): Promise<LockerWithComputed[]> {
    const lockers = await prisma.locker.findMany({ orderBy: { code: "asc" } });
    if (lockers.length === 0) {
      return [];
    }

    const lockerIds = lockers.map((locker) => locker.id);
    const activeRentals = await prisma.lockerRental.findMany({
      where: { lockerId: { in: lockerIds }, status: "ACTIVE" },
      select: { lockerId: true, startAt: true, endAt: true },
    });

    const rentalsByLocker = new Map<string, { startAt: Date; endAt: Date }[]>();
    for (const rental of activeRentals) {
      const existing = rentalsByLocker.get(rental.lockerId) ?? [];
      existing.push({ startAt: rental.startAt, endAt: rental.endAt });
      rentalsByLocker.set(rental.lockerId, existing);
    }

    return lockers.map((locker) => ({
      ...locker,
      displayStatus: calculateLockerDisplayStatus(locker.status, rentalsByLocker.get(locker.id) ?? []),
    }));
  }

  async getLockerWithComputed(lockerId: string): Promise<LockerWithComputed> {
    const locker = await prisma.locker.findUniqueOrThrow({ where: { id: lockerId } });
    return this.attachComputed(locker);
  }

  async getComputedStatus(lockerId: string): Promise<LockerDisplayStatus> {
    return (await this.getLockerWithComputed(lockerId)).displayStatus;
  }

  async getInventorySummary(): Promise<LockerInventorySummary> {
    const lockers = await this.listLockers();

    let availableCount = 0;
    let occupiedCount = 0;
    let maintenanceCount = 0;
    let reservedCount = 0;

    for (const locker of lockers) {
      switch (locker.displayStatus) {
        case "AVAILABLE":
          availableCount += 1;
          break;
        case "OCCUPIED":
          occupiedCount += 1;
          break;
        case "RESERVED":
          reservedCount += 1;
          break;
        case "MAINTENANCE":
        case "DISABLED":
          maintenanceCount += 1;
          break;
      }
    }

    return { availableCount, occupiedCount, maintenanceCount, reservedCount };
  }

  // Derived, not stored — same pattern as equipmentService.getTransactionTimeline.
  async getTransactionTimeline(lockerId: string): Promise<LockerTimelineEvent[]> {
    const [rentals, maintenanceLogs] = await Promise.all([
      prisma.lockerRental.findMany({
        where: { lockerId },
        include: { player: { include: { user: { select: { id: true, name: true, email: true } } } } },
        orderBy: { startAt: "desc" },
      }),
      prisma.lockerMaintenanceLog.findMany({
        where: { lockerId },
        include: { performedBy: { select: { id: true, name: true } } },
        orderBy: { performedAt: "desc" },
      }),
    ]);

    const rentalIds = rentals.map((rental) => rental.id);
    const auditLogs =
      rentalIds.length > 0
        ? await prisma.auditLog.findMany({
            where: { entityType: "LockerRental", entityId: { in: rentalIds } },
            include: { user: { select: { id: true, name: true } } },
          })
        : [];

    function findActorName(entityId: string, action: string): string | null {
      return (
        auditLogs.find((log) => log.entityId === entityId && log.action === action)?.user?.name ?? null
      );
    }

    const events: LockerTimelineEvent[] = [];

    for (const rental of rentals) {
      const playerName = rental.player.user.name ?? rental.player.user.email;
      const issuedBy = findActorName(rental.id, "locker_rental.created");

      events.push({
        type: "RENTAL_ISSUED",
        occurredAt: rental.startAt,
        title: `Issued to ${playerName}`,
        description: [rental.rentalReference, issuedBy ? `by ${issuedBy}` : null]
          .filter(Boolean)
          .join(" — "),
      });

      if (rental.status === "CANCELLED") {
        const endedBy = findActorName(rental.id, "locker_rental.ended");
        events.push({
          type: "RENTAL_ENDED",
          occurredAt: rental.updatedAt,
          title: `Ended early — ${playerName}`,
          description: endedBy ? `Processed by ${endedBy}` : undefined,
        });
      }

      if (rental.status === "EXPIRED") {
        events.push({
          type: "RENTAL_EXPIRED",
          occurredAt: rental.endAt,
          title: `Expired — ${playerName}`,
        });
      }
    }

    for (const log of maintenanceLogs) {
      events.push({
        type: "MAINTENANCE_LOGGED",
        occurredAt: log.performedAt,
        title: `${log.logType} logged`,
        description: [log.note, log.performedBy?.name ? `by ${log.performedBy.name}` : null]
          .filter(Boolean)
          .join(" — "),
      });

      if (log.resolvedAt) {
        events.push({
          type: "MAINTENANCE_RESOLVED",
          occurredAt: log.resolvedAt,
          title: `${log.logType} resolved`,
        });
      }
    }

    return mergeTimelineEvents(events);
  }

  async createLocker(input: CreateLockerInput, actorUserId: string): Promise<Locker> {
    const locker = await prisma.locker.create({ data: { code: input.code } });

    await this.writeAuditLog({
      actorUserId,
      action: "locker.created",
      entityType: "Locker",
      entityId: locker.id,
      newValues: locker,
    });

    return locker;
  }

  async updateLocker(lockerId: string, input: UpdateLockerInput, actorUserId: string): Promise<Locker> {
    const existing = await prisma.locker.findUniqueOrThrow({ where: { id: lockerId } });

    const locker = await prisma.locker.update({
      where: { id: lockerId },
      data: { code: input.code, status: input.status },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "locker.updated",
      entityType: "Locker",
      entityId: locker.id,
      oldValues: existing,
      newValues: locker,
    });

    return locker;
  }

  async listMaintenanceLogs(lockerId: string) {
    return prisma.lockerMaintenanceLog.findMany({
      where: { lockerId },
      orderBy: { performedAt: "desc" },
      include: { performedBy: { select: { id: true, name: true } } },
    });
  }

  async logMaintenance(
    lockerId: string,
    input: LogMaintenanceInput,
    actorUserId: string,
  ): Promise<LockerMaintenanceLog> {
    const log = await prisma.lockerMaintenanceLog.create({
      data: {
        lockerId,
        logType: input.logType,
        note: input.note,
        performedAt: input.performedAt ?? new Date(),
        performedById: actorUserId,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "locker.maintenance_logged",
      entityType: "LockerMaintenanceLog",
      entityId: log.id,
      newValues: log,
    });

    return log;
  }

  async resolveMaintenanceLog(
    logId: string,
    input: ResolveMaintenanceInput,
    actorUserId: string,
  ): Promise<LockerMaintenanceLog> {
    const existing = await prisma.lockerMaintenanceLog.findUniqueOrThrow({ where: { id: logId } });

    if (existing.resolvedAt) {
      throw new Error("This maintenance log entry is already resolved.");
    }

    const log = await prisma.lockerMaintenanceLog.update({
      where: { id: logId },
      data: {
        resolvedAt: new Date(),
        note: input.note ? `${existing.note}\n\nResolution: ${input.note}` : existing.note,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "locker.maintenance_resolved",
      entityType: "LockerMaintenanceLog",
      entityId: log.id,
      newValues: { resolvedAt: log.resolvedAt },
    });

    return log;
  }

  private async attachComputed(locker: Locker): Promise<LockerWithComputed> {
    const activeRentals = await prisma.lockerRental.findMany({
      where: { lockerId: locker.id, status: "ACTIVE" },
      select: { startAt: true, endAt: true },
    });

    const displayStatus = calculateLockerDisplayStatus(locker.status, activeRentals);

    return { ...locker, displayStatus };
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

export const lockerService = new LockerService();
