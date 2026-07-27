"use server";

import { revalidatePath } from "next/cache";

import {
  publicBookingSchema,
  type PublicBookingInput,
} from "@/features/bookings/schemas/public-booking.schema";
import { toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { BookingConflictError, type AvailabilityConflict } from "@/services/booking/booking.service";
import { createPublicBooking } from "@/services/booking/public-booking.service";
import { coachAvailabilityService } from "@/services/coaching/coach-availability.service";
import { coachRateService } from "@/services/coaching/coach-rate.service";

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

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

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
    });

    revalidatePath("/dashboard/bookings");
    revalidatePath("/availability");

    // Coach availability only depends on the slot's time, not whether
    // this booking landed CONFIRMED or as a Phase 8 AWAITING_PAYMENT
    // hold — same startAt/endAt already used to create it, above.
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
    const availableCoaches = coachOptions.filter((coach) => coach.rates.length > 0);

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
