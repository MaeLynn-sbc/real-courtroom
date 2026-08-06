"use server";

import { revalidatePath } from "next/cache";

import {
  publicBookingSchema,
  type PublicBookingInput,
} from "@/features/bookings/schemas/public-booking.schema";
import { toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { BookingConflictError, bookingService, type AvailabilityConflict } from "@/services/booking/booking.service";
import { createPublicBooking } from "@/services/booking/public-booking.service";
import { coachAvailabilityService } from "@/services/coaching/coach-availability.service";
import { coachRateService } from "@/services/coaching/coach-rate.service";

export interface PublicOccupiedWindow {
  startAt: string;
  endAt: string;
}

export interface ListPublicOccupiedWindowsState {
  error: string | null;
  windows: PublicOccupiedWindow[];
}

// Public counterpart to actions/booking.actions.ts's
// listCourtOccupiedWindowsAction (staff-only, permission-gated) — the
// public /book form has no session to gate on at all. Reported live: the
// public form's Time dropdown still offered a slot a real CONFIRMED
// booking already held, discovered only via the server's own conflict
// check at submit — which does reject it correctly (createBookingHold/
// createBooking both run that check inside the same Serializable
// transaction as the write itself, so a conflicting slot can never reach
// a hold or a GCash screen), but staff shouldn't have to trust that path
// alone to save a customer from filling in the whole form for nothing.
// Same underlying query as the staff version (bookingService.
// listOccupiedWindows) — booking/maintenance start-end times only, no
// guest names or any other detail, already exactly as privacy-safe as
// what a "this time is unavailable" dropdown state already implies. No
// rate limit: read-only, same cost profile as the per-slot checkAvailability
// call this form already indirectly triggers via submit, and /api/display
// is already public and unthrottled for the same reason — nothing here
// writes anything.
export async function listPublicCourtOccupiedWindowsAction(
  courtId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<ListPublicOccupiedWindowsState> {
  if (!courtId || Number.isNaN(dayStart.getTime()) || Number.isNaN(dayEnd.getTime()) || dayEnd.getTime() <= dayStart.getTime()) {
    return { error: null, windows: [] };
  }

  const windows = await bookingService.listOccupiedWindows(courtId, dayStart, dayEnd);
  return {
    error: null,
    windows: windows.map((window) => ({ startAt: window.startAt.toISOString(), endAt: window.endAt.toISOString() })),
  };
}

export interface PublicBookingCoachOption {
  id: string;
  name: string;
  // That coach's full group-size -> price table, fetched up front so the
  // confirmation screen can show a rate the instant the customer picks a
  // group size — no per-selection round trip.
  rates: { groupSize: number; priceCents: number }[];
}

export interface PublicBookingActionState {
  error: string | null;
  conflict?: AvailabilityConflict;
  bookingId?: string;
  bookingReference?: string;
  // Phase 8 Gate 2 — only ever true when the owner-controlled prepayment
  // switch is on (settingsService.getBookingRequirePrepayment). Default
  // OFF means this is undefined/false for every booking today, and the
  // rest of this action state is byte-for-byte what it always was.
  requiresPayment?: boolean;
  holdExpiresAt?: Date;
  // Already computed and persisted server-side (pro-rata) — surfaced so
  // the confirmation screen can show what was actually charged.
  totalAmountCents?: number;
  // Coaches with a window fully covering the just-booked slot — computed
  // once here rather than a separate client-triggered lookup, so the
  // confirmation screen's optional "add a coach" step (Gate 3) has
  // exactly what it needs with no extra round trip. Empty, not omitted,
  // when nobody's available — the UI shows "no coaches available" rather
  // than silently having nothing to render. Populated the same way
  // whether the booking that was just created is CONFIRMED or an
  // AWAITING_PAYMENT hold (Phase 8) — coach availability only depends on
  // the slot's time, not the court booking's payment state; see
  // coach-session.service.ts's createCoachSession, which never checks
  // Booking.status either.
  availableCoaches?: PublicBookingCoachOption[];
}

// Shared by createPublicBookingAction (coach options for a slot that was
// JUST booked) and listPublicAvailableCoachesAction below (a live preview
// for a slot the customer hasn't booked yet, so the initial form's total
// can include the coach fee up front) — one query shape, not two
// diverging copies.
async function buildAvailableCoachOptions(startAt: Date, endAt: Date): Promise<PublicBookingCoachOption[]> {
  const coaches = await coachAvailabilityService.listAvailableCoaches(startAt, endAt);
  const coachOptions: PublicBookingCoachOption[] = await Promise.all(
    coaches.map(async (coach) => ({
      id: coach.id,
      name: coach.user.name ?? coach.user.email ?? "Coach",
      rates: (await coachRateService.listRates(coach.id)).map((rate) => ({
        groupSize: rate.groupSize,
        priceCents: rate.priceCents,
      })),
    })),
  );
  // A coach with no rate table can't actually be booked for any group
  // size — don't offer an option that would just error on submit.
  return coachOptions.filter((coach) => coach.rates.length > 0);
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export interface ListPublicAvailableCoachesState {
  error: string | null;
  coaches: PublicBookingCoachOption[];
}

// Preview-only, read-only lookup for the initial booking form (Gate:
// "coach selection moved into the first step, so the Total shown before
// submit already includes the coach fee" — reported live, customers were
// clicking "Register"/"Book Now" without realizing coaching was a
// separate, later step). Same underlying query as
// createPublicBookingAction's own post-booking coach lookup — a candidate
// slot here, an already-booked one there, but coach availability only
// ever depends on the time window either way. No rate limit: read-only,
// same reasoning as listPublicCourtOccupiedWindowsAction just above.
export async function listPublicAvailableCoachesAction(
  startAt: Date,
  endAt: Date,
): Promise<ListPublicAvailableCoachesState> {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt.getTime() <= startAt.getTime()) {
    return { error: null, coaches: [] };
  }
  const coaches = await buildAvailableCoachOptions(startAt, endAt);
  return { error: null, coaches };
}

const COACH_SCHEDULE_DAYS_AHEAD = 14;

export interface PublicCoachScheduleWindow {
  startAt: string;
  endAt: string;
}

export interface ListPublicCoachScheduleState {
  error: string | null;
  windows: PublicCoachScheduleWindow[];
}

// "See this coach's availability," inline on the booking form itself —
// same underlying data as app/coaches/availability/page.tsx (that page
// lists every coach; this scopes to one, on demand, so the booking form
// doesn't have to fetch every coach's whole schedule just to let someone
// preview the one they're considering). Lazy — only called when a
// customer actually clicks "See availability," not on every render of
// the coach picker. No rate limit: read-only, same reasoning as the
// other public lookups in this file.
export async function listPublicCoachScheduleAction(coachId: string): Promise<ListPublicCoachScheduleState> {
  if (!coachId) {
    return { error: null, windows: [] };
  }
  const allCoaches = await coachAvailabilityService.listPublicAvailability(COACH_SCHEDULE_DAYS_AHEAD);
  const coach = allCoaches.find((entry) => entry.coachId === coachId);
  return {
    error: null,
    windows: (coach?.windows ?? []).map((window) => ({
      startAt: window.startAt.toISOString(),
      endAt: window.endAt.toISOString(),
    })),
  };
}

// No session — this is the public, unauthenticated entry point. Thin
// wrapper: validation + rate-limit + revalidation only. The actual
// decision logic (including the Phase 8 prepayment-switch check) lives in
// services/booking/public-booking.service.ts's createPublicBooking, so an
// integration test can call it directly without next/cache's
// revalidatePath throwing outside a real request context — same split
// this session already established for coaching's public path.
export async function createPublicBookingAction(
  input: PublicBookingInput,
): Promise<PublicBookingActionState> {
  const parsedPublic = publicBookingSchema.safeParse(input);
  if (!parsedPublic.success) {
    return { error: parsedPublic.error.issues[0]?.message ?? "Invalid booking details." };
  }

  const rateLimit = checkRateLimit(
    `public-booking:${parsedPublic.data.guestPhone.replace(/\D/g, "")}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return { error: "Too many booking attempts — please wait a while and try again." };
  }

  const startAt = new Date(`${parsedPublic.data.date}T${parsedPublic.data.time}`);
  if (Number.isNaN(startAt.getTime())) {
    return { error: "Enter a valid date and time." };
  }
  const endAt = new Date(startAt.getTime() + parsedPublic.data.durationMinutes * 60 * 1000);
  if (startAt.getTime() <= Date.now()) {
    return { error: "Choose a date and time in the future." };
  }

  try {
    const result = await createPublicBooking({
      courtId: parsedPublic.data.courtId,
      startAt,
      endAt,
      guestName: parsedPublic.data.guestName,
      guestPhone: parsedPublic.data.guestPhone,
      idempotencyKey: parsedPublic.data.idempotencyKey,
    });

    revalidatePath("/dashboard/bookings");
    revalidatePath("/availability");

    // Coach availability only depends on the slot's time, not whether
    // this booking landed CONFIRMED or as a Phase 8 AWAITING_PAYMENT
    // hold — same startAt/endAt already used to create it, above.
    const availableCoaches = await buildAvailableCoachOptions(startAt, endAt);

    return {
      error: null,
      bookingId: result.bookingId,
      bookingReference: result.bookingReference,
      requiresPayment: result.requiresPayment || undefined,
      holdExpiresAt: result.holdExpiresAt,
      totalAmountCents: result.totalAmountCents,
      availableCoaches,
    };
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return { error: error.message, conflict: error.conflict };
    }
    return { error: toActionError(error, { action: "createPublicBookingAction" }) };
  }
}
