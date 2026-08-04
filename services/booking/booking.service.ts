import { randomUUID } from "node:crypto";

import type { CreateBookingInput } from "@/features/bookings/schemas/booking.schema";
import type { Booking, BookingHistory, Prisma } from "@/lib/generated/prisma/client";
import type {
  BookingSource,
  BookingStatus,
  CourtStatus,
  SaleSource,
} from "@/lib/generated/prisma/enums";
import { getBusinessDateRange } from "@/lib/business-date";
import { isWithinCourtBookingWindow } from "@/lib/court-hours";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
import { runSerializableWithRetry } from "@/lib/serializable-retry";
import { hasTimeOverlap } from "@/services/booking/booking-availability";
import { formatBookingReference } from "@/services/booking/booking-reference";
import { canTransitionBookingStatus } from "@/services/booking/booking-status";
import { PAY_AT_VENUE_PAYMENT_METHOD_KEY } from "@/lib/system-identities";
import { coachSessionService } from "@/services/coaching/coach-session.service";
import { recordCoachSessionFeeSale } from "@/services/coaching/coach-session-fee-sale";
import { saleService } from "@/services/sales/sale.service";
import { settingsService } from "@/services/settings/settings.service";
import { getUploadService } from "@/services/upload/upload-service.factory";

// v1.1 Sub-phase 2: every booking is created by a signed-in Employee with a
// currently open Shift — createBookingAction resolves both before calling
// in. Phase 12: `source` is optional and defaults to createSale's own
// default ("RECEPTION") — the public booking action is the first caller to
// pass "WEBSITE" here; every existing staff call site is unaffected.
//
// Settle-bill (pay-at-venue gap fix): paymentMethodId is now OPTIONAL,
// not removed — the public (WEBSITE) non-prepayment path
// (public-booking.service.ts's createPublicBooking) still passes the
// seeded "Pay at Venue" PaymentMethod and still gets an immediate Sale,
// UNCHANGED, since that's a separate, pre-existing behavior this task
// isn't touching. The STAFF path (actions/booking.actions.ts) now omits
// it — the customer's real payment method isn't known at booking time
// (they might pay cash or GCash whenever they actually settle up), so
// createBooking creates NO Sale when paymentMethodId is absent, and
// settling becomes its own later action (settleBooking, below) at the
// moment payment is actually known.
export interface CreateBookingSaleContext {
  employeeId: string;
  // Optional as of the Owner-creates-without-shift exemption
  // (requireEmployeeForBookingCreation, lib/action-auth.ts) — booking
  // CREATION has no money attached (see the Sale-creation branch
  // below), so no shift is needed unless a paymentMethodId is also
  // present. The WEBSITE "pay at venue by default" path always
  // supplies both together (a real shift via the seeded Website
  // system identity) — the runtime check below is what actually
  // enforces that pairing, not the type alone.
  shiftId?: string;
  paymentMethodId?: string;
  source?: SaleSource;
}

// Phase 8 Gate 2 — was "everything CreateBookingInput has except
// paymentMethodId" back when the staff path required one at creation
// time; now a plain alias, since CreateBookingInput itself no longer
// carries a payment method either (settle-bill gap fix — see
// CreateBookingSaleContext's own comment). Kept as a distinct type
// rather than collapsed into CreateBookingInput directly so a future
// divergence between "what a hold needs" and "what a real booking
// needs" has somewhere to live without touching every call site.
export type CreateBookingHoldInput = CreateBookingInput;

export type AvailabilityConflictType =
  "COURT_DISABLED" | "OUTSIDE_OPERATING_HOURS" | "MAINTENANCE" | "BOOKING";

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
  bookedRanges: { startAt: Date; endAt: Date; hasCoach: boolean; coachName?: string }[];
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

export class BookingAlreadySettledError extends Error {
  constructor() {
    super("This booking has already been settled.");
    this.name = "BookingAlreadySettledError";
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
  // Exact single status — the finer filter within a tab (the Bookings
  // page's Status dropdown). Wins over statusIn below when both are
  // somehow present.
  status?: BookingStatus;
  // Reported live: cancelled bookings sitting mixed in with a day's
  // active ones on the main list read as clutter, not history. The
  // Bookings page groups every status into three tabs (Active/
  // Completed/Closed) and passes that tab's whole group here so the
  // default view (no status picked) still only shows that tab's
  // statuses, not every status ever.
  statusIn?: BookingStatus[];
  date?: Date;
  source?: BookingSource;
  // Default stays startAt — the daily schedule view staff use is built
  // around reservation time, not when the booking came in. createdAt is
  // an additional way to look (e.g. "what came in most recently"), not
  // a replacement.
  sortBy?: "startAt" | "createdAt";
  // Cross-date view of every AWAITING_PAYMENT booking whose holdExpiresAt
  // has passed — the set that now blocks its court indefinitely (see
  // checkAvailabilityWithClient's 2026-08-03 comment) until a staff
  // member cancels it. Short-circuits every other filter below: staff
  // need to find these regardless of which day they were created on, not
  // scoped to "today" the way the rest of this page's filters are.
  staleHoldsOnly?: boolean;
}

export class BookingService {
  async listBookings(filters?: ListBookingsFilters) {
    const where: Prisma.BookingWhereInput = {};

    if (filters?.staleHoldsOnly) {
      where.status = "AWAITING_PAYMENT";
      where.holdExpiresAt = { lt: new Date() };
    } else {
      if (filters?.courtId) {
        where.courtId = filters.courtId;
      }
      if (filters?.status) {
        where.status = filters.status;
      } else if (filters?.statusIn) {
        where.status = { in: filters.statusIn };
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
    }

    return prisma.booking.findMany({
      where,
      include: {
        court: true,
        player: { include: { user: { select: { id: true, name: true, email: true } } } },
        // Booking list's Source column: "Staff · <name>" for STAFF-source
        // rows, same {id, name, email} shape and STAFF-only display
        // convention getBookingById's own "Booked by" already uses — see
        // booking-list.tsx.
        bookedBy: { select: { id: true, name: true, email: true } },
        // Payment column (reported live): "has this been paid" is
        // sale != null (see Booking.sale's own comment) — a plain select,
        // not a full include, since the list only needs to know a Sale
        // exists and when. Latest proof only (same as getBookingById) for
        // the "awaiting verification" / "rejected" states and the row's
        // own proof link.
        sale: { select: { createdAt: true } },
        paymentProofs: {
          orderBy: { submittedAt: "desc" },
          take: 1,
          select: { id: true, status: true, submittedAt: true, resolvedAt: true },
        },
        // Reported live (Bea Señeris, BK-20260804-0002): the Payment
        // column read totalAmountCents directly (court hire only) — same
        // bug class as the verification queue had, same fix (see
        // lib/booking-payment-total.ts's getExpectedPaymentTotalCents,
        // which needs this to include the coach add-on).
        // Owner request (2026-08-04): show whether a coach is attached,
        // and their name, directly on the list — coach's own {first,last}
        // name, same shape every other coach-name display in this app
        // already uses.
        coachSession: {
          select: { status: true, rateCents: true, coach: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: filters?.sortBy === "createdAt" ? { createdAt: "desc" } : { startAt: "asc" },
      // Defensive cap — most calls already narrow by date/court/status;
      // this is a backstop against an unfiltered call on a large table,
      // not real pagination (no UI page controls exist for this list).
      take: 200,
    });
  }

  // Dashboard-wide badge — same "Gate 3" precedent as
  // BookingPaymentProofService.countPendingProofs, computed once per
  // layout render (app/dashboard/layout.tsx). A lighter, count-only
  // query than listBookings({ staleHoldsOnly: true }) for the same
  // reason that one exists: most page loads only need the number, not
  // the full row set.
  async countStaleHolds(): Promise<number> {
    return prisma.booking.count({
      where: { status: "AWAITING_PAYMENT", holdExpiresAt: { lt: new Date() } },
    });
  }

  async getBookingById(bookingId: string) {
    return prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        court: true,
        player: { include: { user: { select: { id: true, name: true, email: true } } } },
        bookedBy: { select: { id: true, name: true, email: true } },
        // Settle-bill: sale != null is the actual "has this been paid"
        // signal (see CreateBookingSaleContext's own comment) — the
        // detail page uses this to decide whether to show the Settle
        // Bill form at all.
        sale: true,
        settledBy: { select: { id: true, name: true, email: true } },
        history: {
          orderBy: { createdAt: "asc" },
          include: { changedBy: { select: { id: true, name: true } } },
        },
        // "Viewable after approval" (reported live): the detail page had
        // no link into a submitted GCash proof once it left the pending-
        // verification queue — getProofById() itself is unfiltered by
        // status and already renders an approved/rejected view, so this
        // is just wiring reachability. Only the latest proof (a
        // rejected-then-resubmitted booking's older proof is superseded).
        paymentProofs: {
          orderBy: { submittedAt: "desc" },
          take: 1,
          select: { id: true, status: true },
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

  // Staff booking form's Time dropdown: reported live, staff filled in an
  // entire form only to be told at submit that a slot the dropdown itself
  // was still offering was already booked. This is a live PREVIEW, not the
  // real gate — createBooking's own checkAvailabilityWithClient, run
  // inside its Serializable transaction, stays the actual source of
  // truth; two staff on different devices can still race between this
  // read and either one's eventual write. Same "what counts as occupying
  // this court" rules as checkAvailabilityWithClient (notIn CANCELLED/
  // NO_SHOW/REJECTED — an AWAITING_PAYMENT hold blocks regardless of
  // holdExpiresAt, see that method's own comment for why) — duplicated,
  // not shared, same precedent as display.service.ts's
  // fetchRelevantBookings and coach-session.service.ts's activeSessions
  // query. One day-bounded fetch, not one query per candidate hour —
  // duration only matters for the caller's own per-slot overlap check
  // against these windows, not for this query, so a duration change
  // never needs a new round trip.
  async listOccupiedWindows(courtId: string, dayStart: Date, dayEnd: Date) {
    const [bookings, maintenanceWindows] = await Promise.all([
      prisma.booking.findMany({
        where: {
          courtId,
          status: { notIn: ["CANCELLED", "NO_SHOW", "REJECTED"] },
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
        select: { startAt: true, endAt: true },
      }),
      prisma.courtMaintenance.findMany({
        where: {
          courtId,
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
        select: { startAt: true, endAt: true },
      }),
    ]);
    return [...bookings, ...maintenanceWindows];
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

    // Reversed 2026-08-03 (real incident: a customer's court silently
    // stopped being blocked the moment her 15-minute hold timed out,
    // hours before any staff member ever looked at the booking — by the
    // time staff cancelled the stale hold the next morning, it had
    // already been effectively released, which is what "my booking got
    // cancelled overnight" actually meant from her side). Previously (§15
    // "Held slots expire — orphaned holds must not block a court
    // forever"), an AWAITING_PAYMENT hold whose holdExpiresAt had passed
    // stopped counting as active, on the theory that an unpaid hold
    // shouldn't block a court forever. Owner decision: it's the opposite
    // — a slot a customer started booking must stay reserved for HER
    // until a STAFF MEMBER explicitly decides otherwise (cancel, or the
    // customer's late proof gets rejected — see
    // booking-payment-proof.service.ts's submitBookingPaymentProof,
    // which no longer rejects a late submission for the same reason).
    // holdExpiresAt is kept on the row (still shown to the customer as
    // "held until X," still capped at the booking's own start —
    // createBookingHold/createBooking) but no longer read here at all.
    // The operational tradeoff, deliberately accepted: an abandoned,
    // never-paid booking now occupies its court/time indefinitely until
    // staff notice and cancel it — surfaced via
    // BookingService.listStaleHolds/countStaleHolds and the dashboard
    // banner, so "notice" doesn't mean stumbling onto it by accident.
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
        select: { name: true, hourlyRateCents: true, shortSessionPriceCents: true },
      });
      const durationMinutes = (input.endAt.getTime() - input.startAt.getTime()) / 60_000;
      const durationHours = durationMinutes / 60;
      // Front-desk 30-minute walk-in slot: a flat, per-court,
      // owner-editable price (Court.shortSessionPriceCents, edited
      // alongside hourlyRateCents on the Courts screen), not half the
      // hourly rate — same "flat fee, not derived from a rate table"
      // shape as the Fri/Sat ₱150 walk-in registration fee. The public
      // form's own duration list never offers 30 minutes (features/
      // bookings/components/public-booking-form.tsx stays
      // [60,120,180,240]), so an exactly-30-minute span reaching here
      // always means this staff-only flat price, unambiguously — no
      // separate flag needed on Booking itself to tell the two pricing
      // paths apart later.
      const totalAmountCents =
        durationMinutes === 30
          ? court.shortSessionPriceCents
          : Math.round((court.hourlyRateCents ?? 0) * durationHours);

      // Staff/owner bookings outside the effective operating window
      // are allowed (unlike WEBSITE, which checkAvailabilityWithClient
      // already blocked above) but flagged for reporting —
      // BUILD-SPEC.md §0 "Facility close is a PUBLIC limit, not a
      // data limit." A WEBSITE booking that reached this point already
      // passed the operating-hours check, so this always resolves to
      // false for it.
      const courtHours = await settingsService.getCourtHours();
      const isAfterHours = !isWithinCourtBookingWindow(
        courtHours,
        court.name,
        input.startAt,
        input.endAt,
      );

      // Pre-Phase-8 booking visibility: set once, here, never inferred
      // later from Sale.source (a separate, nullable-linked row) or
      // bookedById (a seeded system identity a reader has to know to
      // check for). Same signal saleContext.source already carries for
      // the twin Sale row created below — WEBSITE is exclusively passed
      // by createPublicBookingAction; every staff call site leaves this
      // undefined, defaulting (like Sale's own source) to the staff case.
      const source: Prisma.BookingCreateInput["source"] =
        saleContext.source === "WEBSITE" ? "PUBLIC" : "STAFF";

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

      // Settle-bill (pay-at-venue gap fix): only create a Sale here when
      // a payment method is actually known right now (the WEBSITE
      // "pay at venue by default" path, which passes the seeded "Pay at
      // Venue" method). The staff path omits paymentMethodId — the
      // booking is created unpaid, and settleBooking (below) creates the
      // Sale later, once the customer's real payment method is known.
      //
      // shiftId is required here even though it's optional on
      // CreateBookingSaleContext as a whole (see that type's own
      // comment) — a Sale can never exist without one
      // (Sale.shiftId is NOT NULL). The only caller that reaches this
      // branch at all (paymentMethodId present) is the WEBSITE path,
      // which always supplies a real shift; this is a genuine invariant
      // violation, not a normal "no shift open" case, if it's ever
      // missing here.
      if (saleContext.paymentMethodId && !saleContext.shiftId) {
        throw new Error(
          "A payment method was provided but no shift is open — cannot create a Sale.",
        );
      }
      const sale = saleContext.paymentMethodId
        ? await saleService.createSale(
            {
              category: "BOOKING",
              source: saleContext.source,
              amountCents: totalAmountCents,
              paymentMethodId: saleContext.paymentMethodId,
              employeeId: saleContext.employeeId,
              // Non-null: the guard just above throws if paymentMethodId
              // is present without a shiftId, so this branch can only be
              // reached with a real one.
              shiftId: saleContext.shiftId!,
              playerId: input.playerId,
              bookingId: created.id,
            },
            tx,
          )
        : null;

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
    if (booking.sale) {
      await saleService.logSaleCreated(booking.sale, actorUserId);
    }

    return booking.booking;
  }

  // "Sometimes customer change their mind... rather play in further
  // court which is court 3 if it's available." Same time slot, a
  // different court — re-checks availability on the NEW court/time
  // combo exactly like createBooking does (excludeBookingId so the
  // booking doesn't conflict with its own current slot), and
  // recomputes totalAmountCents/isAfterHours from the new court's own
  // rate/operating-hours rather than assuming they're unchanged —
  // Court.hourlyRateCents is genuinely per-court data, not guaranteed
  // equal across courts even though today's seed happens to set them
  // all the same. Blocked once a Sale already exists — an already-paid
  // amount can't silently drift if the new court's rate differs;
  // cancel and rebook covers that case instead of a one-off
  // reconciliation path nobody asked for.
  async changeBookingCourt(
    bookingId: string,
    newCourtId: string,
    actorUserId: string,
  ): Promise<Booking> {
    const existing = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { court: true, sale: true },
    });

    if (existing.sale) {
      throw new BookingAlreadySettledError();
    }
    const TERMINAL_STATUSES: BookingStatus[] = [
      "CANCELLED",
      "NO_SHOW",
      "REJECTED",
      "COMPLETED",
      "REFUNDED",
    ];
    if (TERMINAL_STATUSES.includes(existing.status)) {
      throw new Error(
        `Can't change the court on a ${existing.status.toLowerCase().replace("_", " ")} booking.`,
      );
    }
    if (newCourtId === existing.courtId) {
      throw new Error("Already on that court.");
    }

    const updated = await runSerializableWithRetry(async (tx) => {
      const availability = await this.checkAvailabilityWithClient(
        tx,
        newCourtId,
        existing.startAt,
        existing.endAt,
        existing.id,
        existing.source === "PUBLIC",
      );
      if (!availability.available && availability.conflict) {
        throw new BookingConflictError(availability.conflict);
      }

      const newCourt = await tx.court.findUniqueOrThrow({
        where: { id: newCourtId },
        select: { name: true, hourlyRateCents: true, shortSessionPriceCents: true },
      });
      const durationMinutes = (existing.endAt.getTime() - existing.startAt.getTime()) / 60_000;
      const durationHours = durationMinutes / 60;
      const totalAmountCents =
        durationMinutes === 30
          ? newCourt.shortSessionPriceCents
          : Math.round((newCourt.hourlyRateCents ?? 0) * durationHours);

      const courtHours = await settingsService.getCourtHours();
      const isAfterHours = !isWithinCourtBookingWindow(
        courtHours,
        newCourt.name,
        existing.startAt,
        existing.endAt,
      );

      return tx.booking.update({
        where: { id: bookingId },
        data: { courtId: newCourtId, totalAmountCents, isAfterHours },
        include: { court: true },
      });
    });

    await this.writeBookingHistory(
      bookingId,
      existing.status,
      actorUserId,
      `Switched from ${existing.court.name} to ${updated.court.name}`,
    );
    await this.writeAuditLog({
      actorUserId,
      action: "booking.court_changed",
      entityType: "Booking",
      entityId: bookingId,
      oldValues: { courtId: existing.courtId, totalAmountCents: existing.totalAmountCents },
      newValues: { courtId: updated.courtId, totalAmountCents: updated.totalAmountCents },
    });

    return updated;
  }

  // Settle-bill (pay-at-venue gap fix): the customer's payment method
  // wasn't known at booking time — createBooking (above) created this
  // booking with no Sale when staff omitted paymentMethodId. This is
  // where payment is actually collected and recorded, whenever that
  // real moment happens. Mirrors player-tab.service.ts's own settleTab
  // exactly: same method/gcashReference shape (required reference when
  // GCASH), same updateMany({ where: guard })-inside-a-transaction claim
  // pattern so "settle at most once" is atomic under a concurrent
  // double-click, not just checked-then-acted.
  //
  // getExpectedCashForShift / getGcashSalesForDate need no changes at
  // all for this to work correctly — a Sale created here, at the real
  // moment of payment, is picked up by both exactly the same way any
  // other Sale is, and lands on the day it was actually paid instead of
  // the day it was booked (today's actual failure mode, per the gap
  // this fixes: revenue recorded before it was real).
  async settleBooking(
    bookingId: string,
    method: "CASH" | "GCASH",
    gcashReference: string | null,
    saleContext: { employeeId: string; shiftId: string; paymentMethodId: string },
    actorUserId: string,
    receipt?: { fileName: string; contentType: string; data: Buffer },
  ): Promise<Booking> {
    if (method === "GCASH" && !gcashReference?.trim()) {
      throw new Error("A GCash reference number is required.");
    }

    // Found live: staff were picking "Pay at Venue" from this form's
    // payment-method dropdown, reading it as "defer this" — but
    // settling with ANY payment method creates an immediate real Sale,
    // same as Cash/GCash. Pay at Venue's only legitimate use is the
    // WEBSITE "pay at venue by default" creation-time path
    // (public-booking.service.ts), where it correctly means "charge it
    // now, labeled pay-at-venue." Here, settling IS the moment money
    // was actually collected — "pay at venue" (still pending) is a
    // contradiction as a SETTLEMENT method, so it's rejected outright,
    // not just hidden from the form (defense in depth: the UI filter
    // is easy to bypass by anyone constructing the request directly).
    const settlingPaymentMethod = await prisma.paymentMethod.findUniqueOrThrow({
      where: { id: saleContext.paymentMethodId },
    });
    if (settlingPaymentMethod.key === PAY_AT_VENUE_PAYMENT_METHOD_KEY) {
      throw new Error(
        "Pay at Venue isn't a valid settlement method — leave this booking unpaid until the customer actually pays, or record Cash/GCash once they do.",
      );
    }

    // Fast, friendly rejection for the two non-racing cases — not
    // load-bearing on its own. The updateMany inside the transaction
    // below is what actually enforces "settle at most once" under
    // concurrency. Checked separately from settledAt: a WEBSITE booking
    // can already have a Sale from creation time (the "pay at venue by
    // default" path) with settledAt still null, since that path never
    // touches these settlement fields at all — "already paid" is
    // genuinely `sale != null`, not this action's own settledAt marker.
    const precheck = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { sale: true },
    });
    if (precheck.sale) {
      throw new Error("This booking is already paid.");
    }
    if (precheck.settledAt) {
      throw new BookingAlreadySettledError();
    }

    // Same upload-first pattern as expenseService.createExpense — the
    // file lands in storage before the DB write, so its key exists to
    // reference, and gets deleted if the transaction never lands, so a
    // failed settlement never leaves an orphaned file.
    const upload = receipt
      ? await getUploadService().uploadPrivate({
          fileName: receipt.fileName,
          contentType: receipt.contentType,
          data: receipt.data,
        })
      : null;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const claim = await tx.booking.updateMany({
          where: { id: bookingId, settledAt: null },
          data: {
            settledAt: new Date(),
            settledByUserId: actorUserId,
            settledVia: method,
            gcashReference: method === "GCASH" ? gcashReference : null,
            receiptStorageKey: upload?.key,
          },
        });
        if (claim.count === 0) {
          throw new BookingAlreadySettledError();
        }

        const updated = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: { coachSession: { include: { coach: true } } },
        });

        const sale = await saleService.createSale(
          {
            category: "BOOKING",
            amountCents: updated.totalAmountCents ?? 0,
            paymentMethodId: saleContext.paymentMethodId,
            employeeId: saleContext.employeeId,
            shiftId: saleContext.shiftId,
            playerId: updated.playerId ?? undefined,
            bookingId: updated.id,
          },
          tx,
        );

        // Same combined payment, split into a second Sale — see
        // coach-session-fee-sale.ts's own comment for why. Created in
        // the SAME transaction as the court Sale above, not after
        // commit — both are real revenue rows that must land atomically
        // together.
        const coachingSale =
          updated.coachSession && updated.coachSession.status !== "CANCELLED"
            ? await recordCoachSessionFeeSale(
                {
                  coachSessionId: updated.coachSession.id,
                  rateCents: updated.coachSession.rateCents,
                  paymentMethodId: saleContext.paymentMethodId,
                  employeeId: saleContext.employeeId,
                  shiftId: saleContext.shiftId,
                  playerId: updated.playerId,
                },
                tx,
              )
            : null;

        return { booking: updated, sale, coachingSale };
      });

      await this.writeAuditLog({
        actorUserId,
        action: "booking.settled",
        entityType: "Booking",
        entityId: bookingId,
        newValues: { method, amountCents: result.sale.amountCents },
      });
      await saleService.logSaleCreated(result.sale, actorUserId);
      if (result.coachingSale) {
        await saleService.logSaleCreated(result.coachingSale, actorUserId);
      }

      return result.booking;
    } catch (error) {
      if (upload) {
        await getUploadService()
          .delete(upload.key)
          .catch(() => undefined);
      }
      throw error;
    }
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
      // Capped at the booking's own start — an unpaid hold that outlives
      // the session it's holding protects nothing (found live: a
      // booking made ~15 min before a 2-hour-away start got a hold
      // expiring ~2 hours INTO the session). Never zero/negative in
      // practice: the only caller, createPublicBooking, is only ever
      // reached after actions/public-booking.actions.ts's own
      // startAt.getTime() <= Date.now() check has already rejected an
      // elapsed start — so input.startAt is always strictly after `now`
      // here too, just possibly by a short margin for a last-minute
      // booking. That booking gets a correspondingly short hold, never
      // an invalid one.
      const holdMinutes = await settingsService.getBookingHoldMinutes();
      const holdExpiresAt = new Date(
        Math.min(now.getTime() + holdMinutes * 60_000, input.startAt.getTime()),
      );

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

    // Coaching sessions (v1.2) deliberately read their time through this
    // booking rather than duplicating it — "cancelling the court booking
    // removes the coach session" only actually happens if this status
    // transition propagates it, since nothing in this app hard-deletes a
    // Booking row (cancellation is this status update, never a DELETE,
    // so CoachSession.bookingId's ON DELETE CASCADE never fires from
    // real usage). Scoped to CANCELLED only, matching the literal ask —
    // NO_SHOW is a separate, unasked-for question left alone.
    if (status === "CANCELLED") {
      const coachSession = await prisma.coachSession.findUnique({
        where: { bookingId: booking.id },
      });
      if (coachSession && coachSession.status !== "CANCELLED") {
        await coachSessionService.cancelCoachSession(
          coachSession.id,
          actorUserId,
          "Parent court booking was cancelled.",
        );
      }
    }

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

    // Same exclusion checkAvailabilityWithClient already applies to the
    // real availability check — this query feeds the PUBLIC-FACING
    // display (the homepage grid, /availability). An AWAITING_PAYMENT
    // hold blocks regardless of holdExpiresAt now (see that method's own
    // comment) — nothing extra needed here to stay in sync, since this
    // was already just mirroring its status filter, not applying a
    // second, independent one.
    const [bookings, maintenanceWindows] = await Promise.all([
      prisma.booking.findMany({
        where: {
          courtId: { in: courtIds },
          status: { notIn: ["CANCELLED", "NO_SHOW", "REJECTED"] },
          startAt: { lt: endOfDay },
          endAt: { gt: startOfDay },
        },
        // Owner request (2026-08-02): the public grid flags a coached
        // booking with its own colour. coachSession rides along in this
        // SAME query (a JOIN, not a second round trip) — the grid was
        // rebuilt for performance and this must not regress it back to
        // an N+1. status, not just presence: removeCoachSession sets
        // CANCELLED rather than deleting the row, so a booking whose
        // coach was later removed must not still read as coached.
        select: {
          courtId: true,
          startAt: true,
          endAt: true,
          // Owner request (2026-08-05): the public grid's "Coach" sub-
          // label shows the coach's actual name now, not just the bare
          // word — coach.firstName/lastName rides along in this same
          // query, same "JOIN, not a second round trip" reasoning as
          // coachSession.status above.
          coachSession: { select: { status: true, coach: { select: { firstName: true, lastName: true } } } },
        },
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
        .map(({ startAt, endAt, coachSession }) => ({
          startAt,
          endAt,
          hasCoach: coachSession != null && coachSession.status !== "CANCELLED",
          coachName: coachSession
            ? `${coachSession.coach.firstName} ${coachSession.coach.lastName}`
            : undefined,
        })),
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
