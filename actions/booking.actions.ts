"use server";

import { revalidatePath } from "next/cache";

import {
  checkInByTokenSchema,
  createBookingSchema,
  settleBookingSchema,
  updateBookingStatusSchema,
  type CheckInByTokenInput,
  type CreateBookingInput,
  type SettleBookingInput,
  type UpdateBookingStatusInput,
} from "@/features/bookings/schemas/booking.schema";
import { requireEmployeeForBookingCreation, requireEmployeeWithOpenShift, requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import {
  BookingConflictError,
  bookingService,
  type AvailabilityConflict,
} from "@/services/booking/booking.service";
import { PERMISSIONS } from "@/types/permissions";

export interface BookingActionState {
  error: string | null;
  conflict?: AvailabilityConflict;
}

export interface CreateBookingActionState extends BookingActionState {
  bookingId?: string;
}

function requireBookingsManage() {
  return requirePermission(PERMISSIONS.BOOKINGS_MANAGE, "You don't have permission to manage bookings.");
}

export async function createBookingAction(
  input: CreateBookingInput,
): Promise<CreateBookingActionState> {
  // Booking creation has no money attached (see createBooking's own
  // Sale-creation branch — staff bookings are created unpaid), so an
  // open shift is only required unless the caller holds
  // BOOKINGS_CREATE_WITHOUT_SHIFT (Owner, by default — see
  // prisma/seed.ts). settleBookingAction, below, is untouched and
  // still requires a real shift unconditionally, since settling DOES
  // move money.
  const authz = await requireEmployeeForBookingCreation(
    PERMISSIONS.BOOKINGS_MANAGE,
    "You don't have permission to manage bookings.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createBookingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid booking details." };
  }

  try {
    // Settle-bill (pay-at-venue gap fix): no paymentMethodId here — the
    // booking is created unpaid; settleBookingAction records payment
    // later, once it's actually known.
    const booking = await bookingService.createBooking(parsed.data, authz.userId, {
      employeeId: authz.employeeId,
      shiftId: authz.shiftId,
    });
    revalidatePath("/dashboard/bookings");
    return { error: null, bookingId: booking.id };
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return { error: error.message, conflict: error.conflict };
    }
    return { error: toActionError(error, { action: "createBookingAction", userId: authz.userId }) };
  }
}

export async function updateBookingStatusAction(
  bookingId: string,
  input: UpdateBookingStatusInput,
): Promise<BookingActionState> {
  const authz = await requireBookingsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateBookingStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid status." };
  }

  try {
    await bookingService.updateBookingStatus(
      bookingId,
      parsed.data.status,
      authz.userId,
      parsed.data.note,
    );
    revalidatePath("/dashboard/bookings");
    revalidatePath(`/dashboard/bookings/${bookingId}`);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "updateBookingStatusAction", userId: authz.userId }),
    };
  }
}

export async function checkInByTokenAction(
  input: CheckInByTokenInput,
): Promise<BookingActionState & { bookingId?: string }> {
  const authz = await requireBookingsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = checkInByTokenSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid check-in code." };
  }

  try {
    const booking = await bookingService.checkInByToken(parsed.data.token, authz.userId);
    revalidatePath("/dashboard/bookings");
    revalidatePath(`/dashboard/bookings/${booking.id}`);
    return { error: null, bookingId: booking.id };
  } catch (error) {
    return { error: toActionError(error, { action: "checkInByTokenAction", userId: authz.userId }) };
  }
}

// Settle-bill (pay-at-venue gap fix): records payment for a booking
// that was created unpaid (createBookingAction, above, no longer
// collects a payment method up front). requireEmployeeWithOpenShift,
// not just requireBookingsManage — this creates a Sale, same
// employee-with-open-shift requirement every Sale-creating action in
// this app has (see lib/action-auth.ts's own comment).
export async function settleBookingAction(input: SettleBookingInput): Promise<BookingActionState> {
  const authz = await requireEmployeeWithOpenShift(
    PERMISSIONS.BOOKINGS_MANAGE,
    "You don't have permission to manage bookings.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = settleBookingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid settlement details." };
  }

  try {
    await bookingService.settleBooking(
      parsed.data.bookingId,
      parsed.data.method,
      parsed.data.gcashReference?.trim() || null,
      { employeeId: authz.employeeId, shiftId: authz.shiftId, paymentMethodId: parsed.data.paymentMethodId },
      authz.userId,
    );
    revalidatePath("/dashboard/bookings");
    revalidatePath(`/dashboard/bookings/${parsed.data.bookingId}`);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "settleBookingAction", userId: authz.userId }) };
  }
}

export async function regenerateBookingQrTokenAction(
  bookingId: string,
): Promise<BookingActionState> {
  const authz = await requireBookingsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await bookingService.regenerateBookingQrToken(bookingId, authz.userId);
    revalidatePath(`/dashboard/bookings/${bookingId}`);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "regenerateBookingQrTokenAction",
        userId: authz.userId,
      }),
    };
  }
}
