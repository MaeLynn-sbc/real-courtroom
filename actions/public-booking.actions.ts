"use server";

import { revalidatePath } from "next/cache";

import type { CreateBookingInput } from "@/features/bookings/schemas/booking.schema";
import {
  publicBookingSchema,
  type PublicBookingInput,
} from "@/features/bookings/schemas/public-booking.schema";
import { toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  BookingConflictError,
  bookingService,
  type AvailabilityConflict,
} from "@/services/booking/booking.service";
import { getWebsiteBookingContext } from "@/services/booking/website-identity";

export interface PublicBookingActionState {
  error: string | null;
  conflict?: AvailabilityConflict;
  bookingId?: string;
  bookingReference?: string;
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// No session — this is the public, unauthenticated entry point. It
// resolves the seeded Website system identity itself and then calls
// bookingService.createBooking() exactly as createBookingAction does —
// same validation, same Serializable-transaction conflict detection,
// same bookingReference format. See ARCHITECTURE.md's PHASE 12
// addendum for why this identity exists instead of loosening the
// Booking/Sale schema.
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
    const context = await getWebsiteBookingContext();

    // Every field here is already validated above (publicBookingSchema)
    // or computed in this function (startAt/endAt/type) — paymentMethodId
    // is the real seeded "Pay at Venue" id, not customer input, so this
    // doesn't need a second pass through createBookingSchema.
    const bookingInput: CreateBookingInput = {
      courtId: parsedPublic.data.courtId,
      type: "HOURLY",
      startAt,
      endAt,
      guestName: parsedPublic.data.guestName,
      guestPhone: parsedPublic.data.guestPhone,
      paymentMethodId: context.paymentMethodId,
    };

    const booking = await bookingService.createBooking(bookingInput, context.userId, {
      employeeId: context.employeeId,
      shiftId: context.shiftId,
      paymentMethodId: context.paymentMethodId,
      source: "WEBSITE",
    });

    revalidatePath("/dashboard/bookings");
    revalidatePath("/availability");

    return { error: null, bookingId: booking.id, bookingReference: booking.bookingReference };
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return { error: error.message, conflict: error.conflict };
    }
    return { error: toActionError(error, { action: "createPublicBookingAction" }) };
  }
}
