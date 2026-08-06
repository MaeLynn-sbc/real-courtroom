import type { Booking, BookingRefund, Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { saleService } from "@/services/sales/sale.service";

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class BookingNotRefundableError extends Error {
  constructor() {
    super("Only a confirmed booking with a recorded payment can be refunded.");
    this.name = "BookingNotRefundableError";
  }
}

export interface RefundBookingResult {
  booking: Booking;
  refund: BookingRefund;
}

// Real incident (2026-08-06): the public booking double-submit bug
// (services/booking/booking-idempotency-key.integration.ts) produced a
// duplicate, separately-approved Booking for one real GCash payment. This
// is the dedicated action services/booking/booking-status.ts's own comment
// on REFUNDED anticipated — required employee + reason, same "no anonymous
// refunds" rule PlayerTab write-offs already enforce. Deliberately NOT
// wired into BOOKING_STATUS_TRANSITIONS/updateBookingStatusAction, which
// stays a bare status flip with no side effects — this method's entire
// point IS the side effect: voiding the Sale (an offsetting status change,
// never a hard delete — see saleService.voidSale) and recording a durable,
// reasoned BookingRefund row, atomically with the status change.
export class BookingRefundService {
  async refundBooking(
    bookingId: string,
    reason: string,
    employeeId: string,
    actorUserId: string,
  ): Promise<RefundBookingResult> {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      throw new Error("A reason is required to refund a booking.");
    }

    const { booking, refund, sale } = await prisma.$transaction(async (tx) => {
      const existing = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: { sale: true },
      });
      if (existing.status !== "CONFIRMED" || !existing.sale) {
        throw new BookingNotRefundableError();
      }

      const voidedSale = await saleService.voidSale(existing.sale.id, tx);

      const createdRefund = await tx.bookingRefund.create({
        data: {
          bookingId,
          amountCents: voidedSale.amountCents,
          reason: trimmedReason,
          employeeId,
        },
      });

      const updatedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: { status: "REFUNDED" },
      });

      return { booking: updatedBooking, refund: createdRefund, sale: voidedSale };
    });

    await this.writeBookingHistory(booking.id, "REFUNDED", actorUserId, trimmedReason);
    await saleService.logSaleVoided(sale, actorUserId);
    await this.writeAuditLog({
      actorUserId,
      action: "booking.refunded",
      entityType: "Booking",
      entityId: booking.id,
      newValues: { refund, saleId: sale.id, amountCents: refund.amountCents },
    });

    return { booking, refund };
  }

  private async writeBookingHistory(
    bookingId: string,
    status: Booking["status"],
    changedById: string,
    note?: string,
  ): Promise<void> {
    await prisma.bookingHistory.create({
      data: { bookingId, status, changedById, note },
    });
  }

  private async writeAuditLog(entry: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    newValues?: unknown;
  }): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          newValues: toJsonValue(entry.newValues),
        },
      });
    } catch (error) {
      logger.error({ err: error, action: entry.action }, "Failed to write audit log entry");
    }
  }
}

export const bookingRefundService = new BookingRefundService();
