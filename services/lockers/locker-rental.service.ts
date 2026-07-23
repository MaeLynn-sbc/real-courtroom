import type { CreateLockerRentalInput } from "@/features/lockers/schemas/locker.schema";
import type { LockerRental, Prisma } from "@/lib/generated/prisma/client";
import type { LockerRentalStatus } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
// Reused directly rather than reimplemented — Booking is frozen but this
// pure, dependency-free helper is safe to import from a new module (same
// reuse precedent as Open Play's court-assignment.service.ts).
import { hasTimeOverlap } from "@/services/booking/booking-availability";
import { formatLockerRentalReference } from "@/services/lockers/locker-reference";
import { canTransitionLockerRentalStatus } from "@/services/lockers/locker-rental-status";
import { saleService } from "@/services/sales/sale.service";

// v1.1 Sub-phase 2: every rental is created by a signed-in Employee with a
// currently open Shift, and pays through one of the configured
// PaymentMethod rows — createLockerRentalAction resolves both before
// calling in.
export interface CreateLockerRentalSaleContext {
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
  lockerId?: string;
  playerId?: string;
  status?: LockerRentalStatus;
}

const MAX_REFERENCE_ATTEMPTS = 5;

export class LockerRentalService {
  async listRentals(filters?: ListRentalsFilters) {
    await this.reconcileExpiredRentals();

    return prisma.lockerRental.findMany({
      where: { lockerId: filters?.lockerId, playerId: filters?.playerId, status: filters?.status },
      include: {
        locker: true,
        player: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
      orderBy: { startAt: "desc" },
      take: 200,
    });
  }

  async getRentalById(rentalId: string) {
    await this.reconcileExpiredRentals();

    return prisma.lockerRental.findUnique({
      where: { id: rentalId },
      include: {
        locker: true,
        player: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    });
  }

  // Phase 10: the overlap check and the create now run inside one
  // Serializable transaction — same fix, same reasoning, as
  // booking.service.ts's createBooking. v1.1 maintenance: rentalReference
  // now comes from the shared atomic counter (lib/reference-counter.ts),
  // generated inside this same transaction — it can no longer collide, so
  // the retry loop below is now solely for the genuine overlap race
  // (P2034).
  async createRental(
    lockerId: string,
    input: CreateLockerRentalInput,
    actorUserId: string,
    saleContext: CreateLockerRentalSaleContext,
  ): Promise<LockerRental> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt += 1) {
      try {
        const { rental, sale } = await prisma.$transaction(
          async (tx) => {
            const existingActive = await tx.lockerRental.findMany({
              where: { lockerId, status: "ACTIVE" },
              select: { startAt: true, endAt: true },
            });

            const overlaps = existingActive.some((existing) =>
              hasTimeOverlap(input.startAt, input.endAt, existing.startAt, existing.endAt),
            );
            if (overlaps) {
              throw new Error("This locker is already reserved during the requested time.");
            }

            const amountCents = input.amountCents ?? 0;
            const now = new Date();
            const sequence = await nextSequence(dailyScope("LOCKER_RENTAL", now), tx);
            const rentalReference = formatLockerRentalReference(now, sequence);

            const createdRental = await tx.lockerRental.create({
              data: {
                rentalReference,
                lockerId,
                playerId: input.playerId,
                type: input.type,
                startAt: input.startAt,
                endAt: input.endAt,
                amountCents,
                status: "ACTIVE",
              },
            });

            const createdSale = await saleService.createSale(
              {
                category: "LOCKER_RENTAL",
                amountCents,
                paymentMethodId: saleContext.paymentMethodId,
                employeeId: saleContext.employeeId,
                shiftId: saleContext.shiftId,
                playerId: input.playerId,
                lockerRentalId: createdRental.id,
              },
              tx,
            );

            return { rental: createdRental, sale: createdSale };
          },
          { isolationLevel: "Serializable" },
        );

        await this.writeAuditLog({
          actorUserId,
          action: "locker_rental.created",
          entityType: "LockerRental",
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

  // Ending a rental early maps to CANCELLED — LockerRentalStatus has no
  // RETURNED value, and EXPIRED is reserved for the lazy time-based
  // reconciliation below.
  async returnRental(rentalId: string, actorUserId: string): Promise<LockerRental> {
    const existing = await prisma.lockerRental.findUniqueOrThrow({ where: { id: rentalId } });

    if (!canTransitionLockerRentalStatus(existing.status, "CANCELLED")) {
      throw new Error(`Cannot end a rental that is currently ${existing.status}.`);
    }

    const rental = await prisma.lockerRental.update({
      where: { id: rentalId },
      data: { status: "CANCELLED" },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "locker_rental.ended",
      entityType: "LockerRental",
      entityId: rental.id,
      oldValues: { status: existing.status },
      newValues: { status: rental.status },
    });

    return rental;
  }

  // Lazy reconciliation, no background job — flips ACTIVE rentals past
  // endAt to EXPIRED. Not actor-driven, so no AuditLog entry (same
  // precedent as equipmentRentalService.reconcileOverdueRentals).
  async reconcileExpiredRentals(): Promise<void> {
    await prisma.lockerRental.updateMany({
      where: { status: "ACTIVE", endAt: { lt: new Date() } },
      data: { status: "EXPIRED" },
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

export const lockerRentalService = new LockerRentalService();
