import { prisma } from "@/lib/prisma";
import { equipmentService } from "@/services/equipment/equipment.service";
import { lockerService } from "@/services/lockers/locker.service";

// Fixed threshold, no per-item configurable reorder point — keeping this
// simple per this phase's "no automated scheduling" exclusion.
const LOW_STOCK_THRESHOLD = 2;

export type InventoryAlertType =
  | "LOW_STOCK"
  | "UNRESOLVED_DAMAGE"
  | "OVERDUE_EQUIPMENT_RENTAL"
  | "LOCKER_UNDER_MAINTENANCE"
  | "LOCKER_EXPIRED_AWAITING_RECONCILIATION";

export interface InventoryAlert {
  type: InventoryAlertType;
  title: string;
  description?: string;
}

// Computed on every call, never stored. Calls into equipment.service.ts /
// locker.service.ts rather than querying Prisma directly for anything
// those services already expose — keeping database access behind them —
// except for the two "awaiting reconciliation" checks below, which
// deliberately query ahead of the lazy reconciliation those services'
// list methods trigger, so a backlog is visible before it's silently
// fixed on next read.
export class InventoryAlertsService {
  async getAlerts(): Promise<InventoryAlert[]> {
    const alerts: InventoryAlert[] = [];

    const equipmentItems = await equipmentService.listEquipment();
    for (const item of equipmentItems) {
      if (item.status !== "RETIRED" && item.availableQuantity <= LOW_STOCK_THRESHOLD) {
        alerts.push({
          type: "LOW_STOCK",
          title: `${item.name} is low on stock`,
          description: `${item.availableQuantity} of ${item.quantity} available`,
        });
      }
      if (item.condition === "DAMAGED") {
        alerts.push({
          type: "UNRESOLVED_DAMAGE",
          title: `${item.name} has an unresolved damage report`,
        });
      }
    }

    const now = new Date();
    const overdueEquipmentRentals = await prisma.equipmentRental.findMany({
      where: { OR: [{ status: "OVERDUE" }, { status: "ACTIVE", dueAt: { lt: now } }] },
      include: {
        equipment: true,
        player: { include: { user: { select: { name: true, email: true } } } },
      },
    });
    for (const rental of overdueEquipmentRentals) {
      alerts.push({
        type: "OVERDUE_EQUIPMENT_RENTAL",
        title: `${rental.equipment.name} rental is overdue`,
        description: `${rental.player.user.name ?? rental.player.user.email} — ${rental.rentalReference}`,
      });
    }

    const lockers = await lockerService.listLockers();
    for (const locker of lockers) {
      if (locker.displayStatus === "MAINTENANCE") {
        alerts.push({
          type: "LOCKER_UNDER_MAINTENANCE",
          title: `Locker ${locker.code} is under maintenance`,
        });
      }
    }

    const staleLockerRentals = await prisma.lockerRental.findMany({
      where: { status: "ACTIVE", endAt: { lt: now } },
      include: {
        locker: true,
        player: { include: { user: { select: { name: true, email: true } } } },
      },
    });
    for (const rental of staleLockerRentals) {
      alerts.push({
        type: "LOCKER_EXPIRED_AWAITING_RECONCILIATION",
        title: `Locker ${rental.locker.code} rental has expired`,
        description: `${rental.player.user.name ?? rental.player.user.email} — ${rental.rentalReference}`,
      });
    }

    return alerts;
  }
}

export const inventoryAlertsService = new InventoryAlertsService();
