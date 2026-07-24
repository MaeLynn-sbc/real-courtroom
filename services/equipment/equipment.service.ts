import type {
  CreateEquipmentInput,
  LogMaintenanceInput,
  ResolveMaintenanceInput,
  UpdateEquipmentInput,
} from "@/features/equipment/schemas/equipment.schema";
import type { Equipment, EquipmentMaintenanceLog, Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  calculateEquipmentCondition,
  type EquipmentCondition,
} from "@/services/equipment/equipment-condition";
import {
  mergeTimelineEvents,
  type EquipmentTimelineEvent,
} from "@/services/equipment/equipment-timeline";

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

export interface EquipmentWithComputed extends Equipment {
  availableQuantity: number;
  condition: EquipmentCondition;
}

export interface EquipmentInventorySummary {
  availableCount: number;
  rentedCount: number;
  maintenanceCount: number;
  damagedCount: number;
  overdueCount: number;
}

function countByKey<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const k = key(row);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

// Equipment has no deletedAt (unlike Player/Team/Court) — RETIRED is the
// functional equivalent of a soft delete, matching how Court uses
// DISABLED rather than a literal delete.
export class EquipmentService {
  // Public site (House Rules copy) needs the real paddle-rental price
  // without the rest of listEquipment()'s rental/damage-count queries —
  // BUILD-SPEC.md §0 "read from the Equipment record, never hardcoded."
  async getRentalRateCentsByName(name: string): Promise<number | null> {
    const equipment = await prisma.equipment.findUnique({ where: { name }, select: { rentalRateCents: true } });
    return equipment?.rentalRateCents ?? null;
  }

  // Phase 10: batched, not per-item — the previous version called
  // attachComputed() (itself 3-4 queries) once per row via Promise.all,
  // making this ~4N+1 queries for N equipment items (confirmed the
  // dominant cost of the /dashboard KPI load, which calls
  // getInventorySummary → listEquipment). Now 3 queries total regardless
  // of N: one for the equipment rows, one for all active/overdue rentals
  // across every item, one for all unresolved damage reports across every
  // item, grouped into counts in memory.
  async listEquipment(): Promise<EquipmentWithComputed[]> {
    const items = await prisma.equipment.findMany({ orderBy: { name: "asc" } });
    if (items.length === 0) {
      return [];
    }

    const equipmentIds = items.map((item) => item.id);

    const [activeRentals, unresolvedDamageLogs] = await Promise.all([
      prisma.equipmentRental.findMany({
        where: { equipmentId: { in: equipmentIds }, status: { in: ["ACTIVE", "OVERDUE"] } },
        select: { equipmentId: true },
      }),
      prisma.equipmentMaintenanceLog.findMany({
        where: {
          equipmentId: { in: equipmentIds },
          logType: "DAMAGE_REPORT",
          resolvedAt: null,
        },
        select: { equipmentId: true },
      }),
    ]);

    const activeRentalCounts = countByKey(activeRentals, (rental) => rental.equipmentId);
    const damageCounts = countByKey(unresolvedDamageLogs, (log) => log.equipmentId);

    return items.map((item) =>
      this.computeFromCounts(
        item,
        activeRentalCounts.get(item.id) ?? 0,
        damageCounts.get(item.id) ?? 0,
      ),
    );
  }

  async getEquipmentWithComputed(equipmentId: string): Promise<EquipmentWithComputed> {
    const equipment = await prisma.equipment.findUniqueOrThrow({ where: { id: equipmentId } });
    return this.attachComputed(equipment);
  }

  async getComputedCondition(equipmentId: string): Promise<EquipmentCondition> {
    const withComputed = await this.getEquipmentWithComputed(equipmentId);
    return withComputed.condition;
  }

  // Phase 10: accepts an optional transaction client so
  // equipmentRentalService.createRental can run this check inside its
  // Serializable transaction (against `tx`) instead of only ever reading
  // via the default client — defaults to `prisma` so every other existing
  // caller is unaffected.
  async getAvailableQuantity(
    equipmentId: string,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<number> {
    const equipment = await client.equipment.findUniqueOrThrow({ where: { id: equipmentId } });
    const [activeRentalsCount, unresolvedDamageCount] = await Promise.all([
      client.equipmentRental.count({
        where: { equipmentId, status: { in: ["ACTIVE", "OVERDUE"] } },
      }),
      client.equipmentMaintenanceLog.count({
        where: { equipmentId, logType: "DAMAGE_REPORT", resolvedAt: null },
      }),
    ]);
    return Math.max(equipment.quantity - activeRentalsCount - unresolvedDamageCount, 0);
  }

  async getInventorySummary(): Promise<EquipmentInventorySummary> {
    const items = await this.listEquipment();

    let availableCount = 0;
    let rentedCount = 0;
    let maintenanceCount = 0;
    let damagedCount = 0;

    for (const item of items) {
      availableCount += item.availableQuantity;
      rentedCount += Math.max(item.quantity - item.availableQuantity, 0);
      if (item.condition === "MAINTENANCE") {
        maintenanceCount += 1;
      }
      if (item.condition === "DAMAGED") {
        damagedCount += 1;
      }
    }

    const overdueCount = await prisma.equipmentRental.count({ where: { status: "OVERDUE" } });

    return { availableCount, rentedCount, maintenanceCount, damagedCount, overdueCount };
  }

  // Derived, not stored — merges this equipment's rentals and maintenance
  // logs into one chronological feed (the recommended "Transaction
  // History" view). Rental events look up their AuditLog entry to
  // attribute the staff actor, since EquipmentRental has no actor field
  // of its own; maintenance events already carry performedById directly.
  async getTransactionTimeline(equipmentId: string): Promise<EquipmentTimelineEvent[]> {
    const [rentals, maintenanceLogs] = await Promise.all([
      prisma.equipmentRental.findMany({
        where: { equipmentId },
        include: { player: { include: { user: { select: { id: true, name: true, email: true } } } } },
        orderBy: { rentedAt: "desc" },
      }),
      prisma.equipmentMaintenanceLog.findMany({
        where: { equipmentId },
        include: { performedBy: { select: { id: true, name: true } } },
        orderBy: { performedAt: "desc" },
      }),
    ]);

    const rentalIds = rentals.map((rental) => rental.id);
    const auditLogs =
      rentalIds.length > 0
        ? await prisma.auditLog.findMany({
            where: { entityType: "EquipmentRental", entityId: { in: rentalIds } },
            include: { user: { select: { id: true, name: true } } },
          })
        : [];

    function findActorName(entityId: string, action: string): string | null {
      return (
        auditLogs.find((log) => log.entityId === entityId && log.action === action)?.user?.name ?? null
      );
    }

    const events: EquipmentTimelineEvent[] = [];

    for (const rental of rentals) {
      const playerName = rental.player.user.name ?? rental.player.user.email;
      const issuedBy = findActorName(rental.id, "equipment_rental.created");

      events.push({
        type: "RENTAL_ISSUED",
        occurredAt: rental.rentedAt,
        title: `Issued to ${playerName}`,
        description: [rental.rentalReference, issuedBy ? `by ${issuedBy}` : null]
          .filter(Boolean)
          .join(" — "),
      });

      if (rental.status === "RETURNED" && rental.returnedAt) {
        const returnedBy = findActorName(rental.id, "equipment_rental.returned");
        events.push({
          type: "RENTAL_RETURNED",
          occurredAt: rental.returnedAt,
          title: `Returned by ${playerName}`,
          description: returnedBy ? `Processed by ${returnedBy}` : undefined,
        });
      }

      if (rental.status === "LOST") {
        const reportedBy = findActorName(rental.id, "equipment_rental.lost");
        events.push({
          type: "RENTAL_LOST",
          occurredAt: rental.updatedAt,
          title: `Reported lost — ${playerName}`,
          description: reportedBy ? `Reported by ${reportedBy}` : undefined,
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

  async createEquipment(input: CreateEquipmentInput, actorUserId: string): Promise<Equipment> {
    const equipment = await prisma.equipment.create({
      data: {
        name: input.name,
        type: input.type,
        quantity: input.quantity,
        depositCents: input.depositCents ?? 0,
        rentalRateCents: input.rentalRateCents ?? 0,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "equipment.created",
      entityType: "Equipment",
      entityId: equipment.id,
      newValues: equipment,
    });

    return equipment;
  }

  async updateEquipment(
    equipmentId: string,
    input: UpdateEquipmentInput,
    actorUserId: string,
  ): Promise<Equipment> {
    const existing = await prisma.equipment.findUniqueOrThrow({ where: { id: equipmentId } });

    const equipment = await prisma.equipment.update({
      where: { id: equipmentId },
      data: {
        name: input.name,
        type: input.type,
        quantity: input.quantity,
        depositCents: input.depositCents ?? 0,
        rentalRateCents: input.rentalRateCents ?? 0,
        status: input.status,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "equipment.updated",
      entityType: "Equipment",
      entityId: equipment.id,
      oldValues: existing,
      newValues: equipment,
    });

    return equipment;
  }

  async listMaintenanceLogs(equipmentId: string) {
    return prisma.equipmentMaintenanceLog.findMany({
      where: { equipmentId },
      orderBy: { performedAt: "desc" },
      include: { performedBy: { select: { id: true, name: true } } },
    });
  }

  async logMaintenance(
    equipmentId: string,
    input: LogMaintenanceInput,
    actorUserId: string,
  ): Promise<EquipmentMaintenanceLog> {
    const log = await prisma.equipmentMaintenanceLog.create({
      data: {
        equipmentId,
        logType: input.logType,
        note: input.note,
        performedAt: input.performedAt ?? new Date(),
        performedById: actorUserId,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "equipment.maintenance_logged",
      entityType: "EquipmentMaintenanceLog",
      entityId: log.id,
      newValues: log,
    });

    return log;
  }

  async resolveMaintenanceLog(
    logId: string,
    input: ResolveMaintenanceInput,
    actorUserId: string,
  ): Promise<EquipmentMaintenanceLog> {
    const existing = await prisma.equipmentMaintenanceLog.findUniqueOrThrow({ where: { id: logId } });

    if (existing.resolvedAt) {
      throw new Error("This maintenance log entry is already resolved.");
    }

    const log = await prisma.equipmentMaintenanceLog.update({
      where: { id: logId },
      data: {
        resolvedAt: new Date(),
        note: input.note ? `${existing.note}\n\nResolution: ${input.note}` : existing.note,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "equipment.maintenance_resolved",
      entityType: "EquipmentMaintenanceLog",
      entityId: log.id,
      newValues: { resolvedAt: log.resolvedAt },
    });

    return log;
  }

  // Single-item path (equipment detail page, etc.) — not part of the N+1
  // fixed above since it's already O(1) queries for one item; kept
  // separate from listEquipment's batched path rather than routing a
  // single lookup through a batch-of-one for no benefit.
  private async attachComputed(equipment: Equipment): Promise<EquipmentWithComputed> {
    const [activeRentalsCount, unresolvedDamageCount] = await Promise.all([
      prisma.equipmentRental.count({
        where: { equipmentId: equipment.id, status: { in: ["ACTIVE", "OVERDUE"] } },
      }),
      prisma.equipmentMaintenanceLog.count({
        where: { equipmentId: equipment.id, logType: "DAMAGE_REPORT", resolvedAt: null },
      }),
    ]);

    return this.computeFromCounts(equipment, activeRentalsCount, unresolvedDamageCount);
  }

  private computeFromCounts(
    equipment: Equipment,
    activeRentalsCount: number,
    unresolvedDamageCount: number,
  ): EquipmentWithComputed {
    const availableQuantity = Math.max(equipment.quantity - activeRentalsCount - unresolvedDamageCount, 0);
    const hasUnresolvedDamageReport = unresolvedDamageCount > 0;

    const condition = calculateEquipmentCondition({
      status: equipment.status,
      availableQuantity,
      hasUnresolvedDamageReport,
    });

    return { ...equipment, availableQuantity, condition };
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

export const equipmentService = new EquipmentService();
