import { randomUUID } from "node:crypto";

import type { CreateBookingInput } from "@/features/bookings/schemas/booking.schema";
import type {
  Booking,
  BookingHistory,
  Prisma,
} from "@/lib/generated/prisma/client";
import type { BookingSource, BookingStatus, CourtStatus, SaleSource } from "@/lib/generated/prisma/enums";
import { getBusinessDateRange } from "@/lib/business-date";
import { isWithinCourtBookingWindow } from "@/lib/court-hours";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
import { runSerializableWithRetry } from "@/lib/serializable-retry";
import { hasTimeOverlap } from "@/services/booking/booking-availability";
import { formatBookingReference } from "@/services/booking/booking-reference";
import { canTransitionBookingStatus } from "@/services/booking/booking-status";
import { saleService } from "@/services/sales/sale.service";
import { settingsService } from "@/services/settings/settings.service";

// v1.1 Sub-phase 2: every booking is created by a signed-in Employee with a
// currently open Shift, and pays through one of the configured
// PaymentMethod rows — createBookingAction resolves both before calling in.
// Phase 12: `source` is optional and defaults to createSale's own default
// ("RECEPTION") — the public booking action is the first caller to pass
// "WEBSITE" here; every existing staff call site is unaffected.
export interface CreateBookingSaleContext {
  employeeId: string;
  shiftId: string;
  paymentMethodId: string;
  source?: SaleSource;
}

// Phase 8 Gate 2 — everything CreateBookingInput has except
// paymentMethodId: a hold doesn't pay for anything yet, so requiring a
// payment method up front (the way the staff/pay-at-court path does)
// would be meaningless here.
export type CreateBookingHoldInput = Omit<CreateBookingInput, "paymentMethodId">;

// BUILD-SPEC.md §8 "Slot holding": 30 minutes from checkout start.
const HOLD_DURATION_MINUTES = 30;

export type AvailabilityConflictType =
  | "COURT_DISABLED"
  | "OUTSIDE_OPERATING_HOURS"
  | "MAINTENANCE"
  | "BOOKING";

export interface AvailabilityConflict {
  type: AvailabilityConflictType;
  conflictingBookingId?: string;
  conflictingTimeRange?: { startAt: Date; endAt: Date };
}

export interface AvailabilityCheckResult {
  available: boolean;
  conflict?: AvailabilityConflict;
}

export interface PublicCourtDaySchedule {
  courtId: string;
  courtName: string;
  status: CourtStatus;
  bookedRanges: { startAt: Date; endAt: Date }[];
  maintenanceRanges: { startAt: Date; endAt: Date }[];
}

function describeConflict(conflict: AvailabilityConflict): string {
  switch (conflict.type) {
    case "COURT_DISABLED":
      return "This court is currently disabled and cannot be booked.";
    case "OUTSIDE_OPERATING_HOURS":
      return "This court isn't bookable at the selected time — it's Open Play hours.";
    case "MAINTENANCE":
      return "This court has scheduled maintenance during the selected time.";
    case "BOOKING":
      return "This court is already booked during the selected time.";
  }
}

export class BookingConflictError extends Error {
  readonly conflict: AvailabilityConflict;

  constructor(conflict: AvailabilityConflict) {
    super(describeConflict(conflict));
    this.name = "BookingConflictError";
    this.conflict = conflict;
  }
}

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  // Same pattern as services/court/court.service.ts's private helper —
  // duplicated rather than shared, since Court Management is frozen and
  // can't be refactored to import a new shared module.
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

interface ListBookingsFilters {
  courtId?: string;
  status?: BookingStatus;
  date?: Date;
  source?: BookingSource;
  // Default stays startAt — the daily schedule view staff use is built
  // around reservation time, not when the booking came in. createdAt is
  // an additional way to look (e.g. "what came in most recently"), not
  // a replacement.
  sortBy?: "startAt" | "createdAt";
}

export class BookingService {
  async listBookings(filters?: ListBookingsFilters) {
    const where: Prisma.BookingWhereInput = {};

    if (filters?.courtId) {
      where.courtId = filters.courtId;
    }
    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.date) {
      // "Today's bookings" is a business-date filter, not a calendar-day
      // one (BUILD-SPEC.md §0) — a booking at 12:30AM still belongs to the
      // previous night's date on this list, matching daily totals/
      // reconciliation once those exist.
      const { businessDateRolloverHour } = await settingsService.getCourtHours();
      const { start, end } = getBusinessDateRange(filters.date, businessDateRolloverHour);
      where.startAt = { gte: start, lt: end };
    }
    if (filters?.source) {
      where.source = filters.source;
    }

    return prisma.booking.findMany({
      where,
      include: {
        court: true,
        player: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
      orderBy: filters?.sortBy === "createdAt" ? { createdAt: "desc" } : { startAt: "asc" },
      // Defensive cap — most calls already narrow by date/court/status;
      // this is a backstop against an unfiltered call on a large table,
      // not real pagination (no UI page controls exist for this list).
      take: 200,
    });
  }

  async getBookingById(bookingId: string) {
    return prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        court: true,
        player: { include: { user: { select: { id: true, name: true, email: true } } } },
        bookedBy: { select: { id: true, name: true, email: true } },
        history: {
          orderBy: { createdAt: "asc" },
          include: { changedBy: { select: { id: true, name: true } } },
        },
      },
    });
  }

  async getBookingByQrToken(token: string) {
    return prisma.booking.findUnique({
      where: { qrCodeToken: token },
      include: {
        court: true,
        player: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    });
  }

  async checkAvailability(
    courtId: string,
    startAt: Date,
    endAt: Date,
    excludeBookingId?: string,
  ): Promise<AvailabilityCheckResult> {
    return this.checkAvailabilityWithClient(prisma, courtId, startAt, endAt, excludeBookingId);
  }

  // Phase 10: extracted so createBooking can run this same check inside its
  // Serializable transaction (against `tx`, not the default `prisma`
  // client) — the public checkAvailability above is unchanged (still reads
  // via the default client) for the UI's live pre-submit check, which was
  // never the racy part; the race was always the gap between that read and
  // the eventual write.
  private async checkAvailabilityWithClient(
    client: Prisma.TransactionClient | typeof prisma,
    courtId: string,
    startAt: Date,
    endAt: Date,
    excludeBookingId?: string,
    enforceOperatingHours = false,
  ): Promise<AvailabilityCheckResult> {
    const court = await client.court.findUniqueOrThrow({ where: { id: courtId } });

    if (court.status === "DISABLED") {
      return { available: false, conflict: { type: "COURT_DISABLED" } };
    }

    if (enforceOperatingHours) {
      const courtHours = await settingsService.getCourtHours();
      if (!isWithinCourtBookingWindow(courtHours, court.name, startAt, endAt)) {
        return { available: false, conflict: { type: "OUTSIDE_OPERATING_HOURS" } };
      }
    }

    const maintenanceWindows = await client.courtMaintenance.findMany({
      where: { courtId, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
      select: { startAt: true, endAt: true },
    });

    const conflictingMaintenance = maintenanceWindows.find((window) =>
      hasTimeOverlap(startAt, endAt, window.startAt, window.endAt),
    );

    if (conflictingMaintenance) {
      return {
        available: false,
        conflict: {
          type: "MAINTENANCE",
          conflictingTimeRange: {
            startAt: conflictingMaintenance.startAt,
            endAt: conflictingMaintenance.endAt,
          },
        },
      };
    }

    // Phase 8 Gate 2 (§15 "Held slots expire — orphaned holds must not
    // block a court forever"): an AWAITING_PAYMENT hold whose
    // holdExpiresAt has passed does NOT count as active — same effect as
    // if it were already CANCELLED, without needing a cron job to
    // actually flip it. Lazy exclusion is sufficient for correctness on
    // its own (nothing else needs to run for the slot to free up); an
    // opportunistic sweep to CANCELLED for a clean audit trail is a
    // separate, non-load-bearing concern, not implemented here. Inert for
    // every booking created before this Gate: `status: { not:
    // "AWAITING_PAYMENT" }` is true for all of them, since nothing before
    // this phase can ever produce that status.
    const now = new Date();
    const activeBookings = await client.booking.findMany({
      where: {
        courtId,
        // REJECTED (§8 item 3: "no valid payment ever arrived... the slot
        // releases") is excluded for the same reason CANCELLED/NO_SHOW
        // are — it's a terminal, non-blocking outcome. Distinct from
        // REFUNDED, which is deliberately NOT excluded here: a refunded
        // booking was, by definition, once CONFIRMED and real (the
        // business's own error, not the customer's), and this phase
        // doesn't build the refund action that would even produce that
        // status yet — left as future work to decide alongside it, not
        // assumed here.
        status: { notIn: ["CANCELLED", "NO_SHOW", "REJECTED"] },
        OR: [{ status: { not: "AWAITING_PAYMENT" } }, { holdExpiresAt: null }, { holdExpiresAt: { gte: now } }],
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
      select: { id: true, startAt: true, endAt: true },
    });

    const conflictingBooking = activeBookings.find((booking) =>
      hasTimeOverlap(startAt, endAt, booking.startAt, booking.endAt),
    );

    if (conflictingBooking) {
      return {
        available: false,
        conflict: {
          type: "BOOKING",
          conflictingBookingId: conflictingBooking.id,
          conflictingTimeRange: {
            startAt: conflictingBooking.startAt,
            endAt: conflictingBooking.endAt,
          },
        },
      };
    }

    return { available: true };
  }

  // Phase 10: the availability check and the create now run inside one
  // Serializable transaction — previously two separate awaited calls with
  // a gap between them, so two concurrent requests for the same
  // court/time could both read "available" before either wrote. Postgres
  // now aborts the losing side (P2034), caught by runSerializableWithRetry
  // and retried. v1.1 maintenance: bookingReference now comes from the
  // shared atomic counter (lib/reference-counter.ts) generated inside this
  // same transaction, so it can no longer collide — the retry exists
  // solely for genuine availability races now (P2034), though the P2002
  // retry stays as a defensive backstop for the unrelated qrCodeToken
  // unique column. Hardening phase (BUILD-SPEC.md §0/§15): confirmed live
  // under real concurrent load
  // (services/booking/booking.concurrency.integration.ts) — two
  // concurrent createBooking calls for the same court/overlapping time
  // never both succeed.
  async createBooking(
    input: CreateBookingInput,
    actorUserId: string,
    saleContext: CreateBookingSaleContext,
  ): Promise<Booking> {
    const qrCodeToken = randomUUID();

    const booking = await runSerializableWithRetry(async (tx) => {
      const availability = await this.checkAvailabilityWithClient(
        tx,
        input.courtId,
        input.startAt,
        input.endAt,
        undefined,
        saleContext.source === "WEBSITE",
      );
      if (!availability.available && availability.conflict) {
        throw new BookingConflictError(availability.conflict);
      }

      const now = new Date();
      const sequence = await nextSequence(dailyScope("BOOKING", now), tx);
      const bookingReference = formatBookingReference(now, sequence);

      const court = await tx.court.findUniqueOrThrow({
        where: { id: input.courtId },
        select: { name: true, hourlyRateCents: true },
      });
      const durationHours = (input.endAt.getTime() - input.startAt.getTime()) / 3_600_000;
      const totalAmountCents = Math.round((court.hourlyRateCents ?? 0) * durationHours);

      // Staff/owner bookings outside the effective operating window
      // are allowed (unlike WEBSITE, which checkAvailabilityWithClient
      // already blocked above) but flagged for reporting —
      // BUILD-SPEC.md §0 "Facility close is a PUBLIC limit, not a
      // data limit." A WEBSITE booking that reached this point already
      // passed the operating-hours check, so this always resolves to
      // false for it.
      const courtHours = await settingsService.getCourtHours();
      const isAfterHours = !isWithinCourtBookingWindow(courtHours, court.name, input.startAt, input.endAt);

      // Pre-Phase-8 booking visibility: set once, here, never inferred
      // later from Sale.source (a separate, nullable-linked row) or
      // bookedById (a seeded system identity a reader has to know to
      // check for). Same signal saleContext.source already carries for
      // the twin Sale row created below — WEBSITE is exclusively passed
      // by createPublicBookingAction; every staff call site leaves this
      // undefined, defaulting (like Sale's own source) to the staff case.
      const source: Prisma.BookingCreateInput["source"] = saleContext.source === "WEBSITE" ? "PUBLIC" : "STAFF";

      const created = await tx.booking.create({
        data: {
          bookingReference,
          courtId: input.courtId,
          bookedById: actorUserId,
          playerId: input.playerId,
          type: input.type,
          status: "CONFIRMED",
          source,
          startAt: input.startAt,
          endAt: input.endAt,
          guestName: input.guestName,
          guestPhone: input.guestPhone,
          guestEmail: input.guestEmail,
          totalAmountCents,
          notes: input.notes,
          qrCodeToken,
          isAfterHours,
        },
      });

      const sale = await saleService.createSale(
        {
          category: "BOOKING",
          source: saleContext.source,
          amountCents: totalAmountCents,
          paymentMethodId: saleContext.paymentMethodId,
          employeeId: saleContext.employeeId,
          shiftId: saleContext.shiftId,
          playerId: input.playerId,
          bookingId: created.id,
        },
        tx,
      );

      return { booking: created, sale };
    });

    await this.writeBookingHistory(booking.booking.id, "CONFIRMED", actorUserId);
    await this.writeAuditLog({
      actorUserId,
      action: "booking.created",
      entityType: "Booking",
      entityId: booking.booking.id,
      newValues: booking.booking,
    });
    await saleService.logSaleCreated(booking.sale, actorUserId);

    return booking.booking;
  }

  // Phase 8 Gate 2 (BUILD-SPEC.md §8 "Slot holding"). Deliberately a
  // SEPARATE method from createBooking above, not a branch inside it —
  // createBooking's own source is untouched by this whole phase, which is
  // the strongest form of the hard boundary proof: the function every
  // existing caller (staff bookings, and the public path with the switch
  // off) goes through literally has not changed. Only
  // actions/public-booking.actions.ts decides which of the two methods to
  // call, and only when the prepayment switch is on.
  //
  // No Sale here — that's the whole point of a hold. paymentMethodId
  // isn't part of the input (unlike createBooking's) because nothing is
  // being paid for yet; the real payment method (GCash) gets recorded
  // when a staff member approves the submitted proof.
  async createBookingHold(input: CreateBookingHoldInput, actorUserId: string): Promise<Booking> {
    const qrCodeToken = randomUUID();

    const booking = await runSerializableWithRetry(async (tx) => {
      // Public path always enforces operating hours, same as
      // createBooking does for source="WEBSITE" — a hold can't reserve a
      // slot the public site wouldn't otherwise let it book.
      const availability = await this.checkAvailabilityWithClient(
        tx,
        input.courtId,
        input.startAt,
        input.endAt,
        undefined,
        true,
      );
      if (!availability.available && availability.conflict) {
        throw new BookingConflictError(availability.conflict);
      }

      const now = new Date();
      const sequence = await nextSequence(dailyScope("BOOKING", now), tx);
      const bookingReference = formatBookingReference(now, sequence);

      const court = await tx.court.findUniqueOrThrow({
        where: { id: input.courtId },
        select: { hourlyRateCents: true },
      });
      const durationHours = (input.endAt.getTime() - input.startAt.getTime()) / 3_600_000;
      const totalAmountCents = Math.round((court.hourlyRateCents ?? 0) * durationHours);
      const holdExpiresAt = new Date(now.getTime() + HOLD_DURATION_MINUTES * 60_000);

      return tx.booking.create({
        data: {
          bookingReference,
          courtId: input.courtId,
          bookedById: actorUserId,
          playerId: input.playerId,
          type: input.type,
          status: "AWAITING_PAYMENT",
          source: "PUBLIC",
          startAt: input.startAt,
          endAt: input.endAt,
          guestName: input.guestName,
          guestPhone: input.guestPhone,
          guestEmail: input.guestEmail,
          totalAmountCents,
          notes: input.notes,
          qrCodeToken,
          // Already enforced above (enforceOperatingHours: true) — a hold
          // can never land after-hours, unlike a staff booking.
          isAfterHours: false,
          holdExpiresAt,
        },
      });
    });

    await this.writeBookingHistory(booking.id, "AWAITING_PAYMENT", actorUserId);
    await this.writeAuditLog({
      actorUserId,
      action: "booking.hold_created",
      entityType: "Booking",
      entityId: booking.id,
      newValues: booking,
    });

    return booking;
  }

  async updateBookingStatus(
    bookingId: string,
    status: BookingStatus,
    actorUserId: string,
    note?: string,
  ): Promise<Booking> {
    const existing = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });

    if (!canTransitionBookingStatus(existing.status, status)) {
      throw new Error(`Cannot move a booking from ${existing.status} to ${status}.`);
    }

    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status,
        cancelledAt: status === "CANCELLED" ? new Date() : existing.cancelledAt,
      },
    });

    await this.writeBookingHistory(booking.id, status, actorUserId, note);
    await this.writeAuditLog({
      actorUserId,
      action: "booking.status_changed",
      entityType: "Booking",
      entityId: booking.id,
      oldValues: { status: existing.status },
      newValues: { status: booking.status },
    });

    return booking;
  }

  async checkInByToken(token: string, actorUserId: string): Promise<Booking> {
    const booking = await prisma.booking.findUnique({ where: { qrCodeToken: token } });
    if (!booking) {
      throw new Error("No booking found for this check-in code.");
    }

    return this.updateBookingStatus(booking.id, "CHECKED_IN", actorUserId);
  }

  async regenerateBookingQrToken(bookingId: string, actorUserId: string): Promise<Booking> {
    const newToken = randomUUID();

    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data: { qrCodeToken: newToken },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "booking.qr_token_regenerated",
      entityType: "Booking",
      entityId: booking.id,
    });

    return booking;
  }

  // Phase 12: powers the public availability page. Deliberately just an
  // aggregated read of the same booking/maintenance data
  // checkAvailabilityWithClient already queries for a single point-in-time
  // check — no new conflict-detection logic, just "list what's busy today"
  // instead of "is this one slot free."
  async getPublicDaySchedule(date: Date): Promise<PublicCourtDaySchedule[]> {
    const courts = await prisma.court.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
    });
    const courtIds = courts.map((court) => court.id);
    const { startOfDay, endOfDay } = dayRange(date);

    const [bookings, maintenanceWindows] = await Promise.all([
      prisma.booking.findMany({
        where: {
          courtId: { in: courtIds },
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
          startAt: { lt: endOfDay },
          endAt: { gt: startOfDay },
        },
        select: { courtId: true, startAt: true, endAt: true },
      }),
      prisma.courtMaintenance.findMany({
        where: {
          courtId: { in: courtIds },
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
          startAt: { lt: endOfDay },
          endAt: { gt: startOfDay },
        },
        select: { courtId: true, startAt: true, endAt: true },
      }),
    ]);

    return courts.map((court) => ({
      courtId: court.id,
      courtName: court.name,
      status: court.status,
      bookedRanges: bookings
        .filter((booking) => booking.courtId === court.id)
        .map(({ startAt, endAt }) => ({ startAt, endAt })),
      maintenanceRanges: maintenanceWindows
        .filter((window) => window.courtId === court.id)
        .map(({ startAt, endAt }) => ({ startAt, endAt })),
    }));
  }

  // Phase 12: powers the public booking-lookup page. Phone match is a
  // lightweight anti-enumeration check (stops guessing a reference alone
  // from revealing someone else's booking), not real authentication.
  async findByReferenceAndPhone(reference: string, phone: string) {
    const booking = await prisma.booking.findUnique({
      where: { bookingReference: reference },
      include: { court: true, player: { include: { user: true } } },
    });
    if (!booking) {
      return null;
    }

    const normalize = (value: string) => value.replace(/\D/g, "");
    const providedPhone = normalize(phone);
    const bookingPhone = normalize(booking.guestPhone ?? booking.player?.phone ?? "");

    if (!providedPhone || !bookingPhone || bookingPhone !== providedPhone) {
      return null;
    }

    return booking;
  }

  async getBookingHistory(bookingId: string): Promise<BookingHistory[]> {
    return prisma.bookingHistory.findMany({
      where: { bookingId },
      orderBy: { createdAt: "asc" },
    });
  }

  private async writeBookingHistory(
    bookingId: string,
    status: BookingStatus,
    changedById: string,
    note?: string,
  ): Promise<void> {
    await prisma.bookingHistory.create({
      data: { bookingId, status, changedById, note },
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

function dayRange(date: Date): { startOfDay: Date; endOfDay: Date } {
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);
  return { startOfDay, endOfDay };
}

export const bookingService = new BookingService();
