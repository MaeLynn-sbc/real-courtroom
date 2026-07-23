"use server";

import { revalidatePath } from "next/cache";

import {
  checkInByTokenSchema,
  createBookingSchema,
  updateBookingStatusSchema,
  type CheckInByTokenInput,
  type CreateBookingInput,
  type UpdateBookingStatusInput,
} from "@/features/bookings/schemas/booking.schema";
import { requireEmployeeWithOpenShift, requirePermission } from "@/lib/action-auth";
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
  const authz = await requireEmployeeWithOpenShift(
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
    const booking = await bookingService.createBooking(parsed.data, authz.userId, {
      employeeId: authz.employeeId,
      shiftId: authz.shiftId,
      paymentMethodId: parsed.data.paymentMethodId,
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
