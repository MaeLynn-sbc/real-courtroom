import type { CreateEquipmentRentalInput } from "@/features/equipment/schemas/equipment.schema";
import type { EquipmentRental, Prisma } from "@/lib/generated/prisma/client";
import type { RentalStatus } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
import { equipmentService } from "@/services/equipment/equipment.service";
import { formatEquipmentRentalReference } from "@/services/equipment/equipment-reference";
import { canTransitionRentalStatus } from "@/services/equipment/rental-status";
import { saleService } from "@/services/sales/sale.service";

// v1.1 Sub-phase 2: every rental is created by a signed-in Employee with a
// currently open Shift, and pays through one of the configured
// PaymentMethod rows — createEquipmentRentalAction resolves both before
// calling in.
export interface CreateEquipmentRentalSaleContext {
  employeeId: string;
  shiftId: string;
  paymentMethodId: string;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

// Phase 10: see booking.service.ts's identical helper for why P2034 is
// retried the same way a reference collision already was. v1.1
// maintenance: also catches the P2010-wrapped form of the same underlying
// Postgres conflict that nextSequence's raw-query counter increment
// (lib/reference-counter.ts) surfaces — see booking.service.ts's copy of
// this helper for the full explanation.
function isSerializationFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (code === "P2034") {
    return true;
  }
  if (code === "P2010") {
    const meta = (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } }).meta;
    return meta?.driverAdapterError?.cause?.originalCode === "40001";
  }
  return false;
}

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

interface ListRentalsFilters {
  equipmentId?: string;
  playerId?: string;
  status?: RentalStatus;
}

const MAX_REFERENCE_ATTEMPTS = 5;

export class EquipmentRentalService {
  async listRentals(filters?: ListRentalsFilters) {
    await this.reconcileOverdueRentals();

    return prisma.equipmentRental.findMany({
      where: { equipmentId: filters?.equipmentId, playerId: filters?.playerId, status: filters?.status },
      include: {
        equipment: true,
        player: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
      orderBy: { rentedAt: "desc" },
      take: 200,
    });
  }

  async getRentalById(rentalId: string) {
    await this.reconcileOverdueRentals();

    return prisma.equipmentRental.findUnique({
      where: { id: rentalId },
      include: {
        equipment: true,
        player: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    });
  }

  // Phase 10: the availableQuantity check and the create now run inside
  // one Serializable transaction — same fix, same reasoning, as
  // booking.service.ts's createBooking. Two concurrent rentals when
  // availableQuantity === 1 could previously both pass the check and both
  // create, overbooking the pool.
  // v1.1 maintenance: rentalReference now comes from the shared atomic
  // counter (lib/reference-counter.ts), generated inside this same
  // transaction — it can no longer collide, so the retry loop below is
  // now solely for the genuine availableQuantity race (P2034).
  async createRental(
    equipmentId: string,
    input: CreateEquipmentRentalInput,
    actorUserId: string,
    saleContext: CreateEquipmentRentalSaleContext,
  ): Promise<EquipmentRental> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt += 1) {
      try {
        const { rental, sale } = await prisma.$transaction(
          async (tx) => {
            const availableQuantity = await equipmentService.getAvailableQuantity(equipmentId, tx);
            if (availableQuantity < 1) {
              throw new Error("No units of this equipment are currently available to rent.");
            }

            const equipment = await tx.equipment.findUniqueOrThrow({
              where: { id: equipmentId },
              select: { rentalRateCents: true },
            });

            const now = new Date();
            const sequence = await nextSequence(dailyScope("EQUIPMENT_RENTAL", now), tx);
            const rentalReference = formatEquipmentRentalReference(now, sequence);

            const createdRental = await tx.equipmentRental.create({
              data: {
                rentalReference,
                equipmentId,
                playerId: input.playerId,
                dueAt: input.dueAt,
                status: "ACTIVE",
              },
            });

            const createdSale = await saleService.createSale(
              {
                category: "EQUIPMENT_RENTAL",
                amountCents: equipment.rentalRateCents,
                paymentMethodId: saleContext.paymentMethodId,
                employeeId: saleContext.employeeId,
                shiftId: saleContext.shiftId,
                playerId: input.playerId,
                equipmentRentalId: createdRental.id,
              },
              tx,
            );

            return { rental: createdRental, sale: createdSale };
          },
          { isolationLevel: "Serializable" },
        );

        await this.writeAuditLog({
          actorUserId,
          action: "equipment_rental.created",
          entityType: "EquipmentRental",
          entityId: rental.id,
          newValues: rental,
        });
        await saleService.logSaleCreated(sale, actorUserId);

        return rental;
      } catch (error) {
        if (isUniqueConstraintViolation(error) || isSerializationFailure(error)) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Failed to create this rental after several attempts.");
  }

  async returnRental(rentalId: string, actorUserId: string): Promise<EquipmentRental> {
    const existing = await prisma.equipmentRental.findUniqueOrThrow({ where: { id: rentalId } });

    if (!canTransitionRentalStatus(existing.status, "RETURNED")) {
      throw new Error(`Cannot return a rental that is currently ${existing.status}.`);
    }

    const rental = await prisma.equipmentRental.update({
      where: { id: rentalId },
      data: { status: "RETURNED", returnedAt: new Date() },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "equipment_rental.returned",
      entityType: "EquipmentRental",
      entityId: rental.id,
      oldValues: { status: existing.status },
      newValues: { status: rental.status, returnedAt: rental.returnedAt },
    });

    return rental;
  }

  async markLost(rentalId: string, actorUserId: string): Promise<EquipmentRental> {
    const existing = await prisma.equipmentRental.findUniqueOrThrow({ where: { id: rentalId } });

    if (!canTransitionRentalStatus(existing.status, "LOST")) {
      throw new Error(`Cannot mark a rental lost when it's currently ${existing.status}.`);
    }

    const rental = await prisma.equipmentRental.update({
      where: { id: rentalId },
      data: { status: "LOST" },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "equipment_rental.lost",
      entityType: "EquipmentRental",
      entityId: rental.id,
      oldValues: { status: existing.status },
      newValues: { status: rental.status },
    });

    return rental;
  }

  // Lazy reconciliation, no background job (this app has none) — flips
  // ACTIVE rentals past dueAt to OVERDUE. Not actor-driven, so no
  // AuditLog entry is written for it (same precedent as
  // membershipService.reconcileExpiredMemberships skipping AuditLog for
  // automatic transitions).
  async reconcileOverdueRentals(): Promise<void> {
    await prisma.equipmentRental.updateMany({
      where: { status: "ACTIVE", dueAt: { lt: new Date() } },
      data: { status: "OVERDUE" },
    });
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

export const equipmentRentalService = new EquipmentRentalService();
