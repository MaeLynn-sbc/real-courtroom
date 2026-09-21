"use server";

import { revalidatePath } from "next/cache";

import {
  changeBookingSlotSchema,
  checkInByTokenSchema,
  createBookingSchema,
  refundBookingSchema,
  settleBookingSchema,
  updateBookingStatusSchema,
  type ChangeBookingSlotInput,
  type CheckInByTokenInput,
  type CreateBookingInput,
  type RefundBookingInput,
  type SettleBookingInput,
  type UpdateBookingStatusInput,
} from "@/features/bookings/schemas/booking.schema";
import {
  requireEmployee,
  requireEmployeeForBookingCreation,
  requireEmployeeForSaleWithShiftBypass,
  requirePermission,
} from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { bookingRefundService } from "@/services/booking/booking-refund.service";
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

export interface OccupiedWindow {
  startAt: string;
  endAt: string;
}

export interface ListOccupiedWindowsState {
  error: string | null;
  windows: OccupiedWindow[];
}

function requireBookingsManage() {
  return requirePermission(
    PERMISSIONS.BOOKINGS_MANAGE,
    "You don't have permission to manage bookings.",
  );
}

// Staff booking form's Time dropdown live-availability preview — see
// bookingService.listOccupiedWindows's own comment for why this is a day-
// bounded fetch rather than per-candidate-hour, and why it's a preview,
// not the real gate.
export async function listCourtOccupiedWindowsAction(
  courtId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<ListOccupiedWindowsState> {
  const authz = await requireBookingsManage();
  if (!authz.ok) {
    return { error: authz.error, windows: [] };
  }

  if (
    !courtId ||
    Number.isNaN(dayStart.getTime()) ||
    Number.isNaN(dayEnd.getTime()) ||
    dayEnd.getTime() <= dayStart.getTime()
  ) {
    return { error: null, windows: [] };
  }

  const windows = await bookingService.listOccupiedWindows(courtId, dayStart, dayEnd);
  return {
    error: null,
    windows: windows.map((window) => ({
      startAt: window.startAt.toISOString(),
      endAt: window.endAt.toISOString(),
    })),
  };
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

// Owner request (2026-09-22), after the P700 duplicate-booking incident:
// bookingRefundService.refundBooking has existed (and been tested) since
// the August double-submit incident it was written for, but nothing ever
// called it — no action, no button. Staff therefore had only Cancel,
// which leaves a settled payment counting as revenue, and ended up
// logging the money they gave back as an operating expense instead.
// This is that missing wiring.
//
// Gated on ACCOUNTS_VOID_SALE rather than BOOKINGS_MANAGE, and via
// requireEmployee not requirePermission: a refund voids a Sale, so it is
// the same authority (and the same "a real employee is attributed to
// this" rule) as voidSaleAction. Owner-only by default; grant it to a
// staff role from the Roles screen if the desk should do refunds.
export async function refundBookingAction(
  input: RefundBookingInput,
): Promise<BookingActionState> {
  const authz = await requireEmployee(
    PERMISSIONS.ACCOUNTS_VOID_SALE,
    "You don't have permission to refund a booking.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = refundBookingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid refund." };
  }

  try {
    await bookingRefundService.refundBooking(
      parsed.data.bookingId,
      parsed.data.reason,
      authz.employeeId,
      authz.userId,
    );
    revalidatePath("/dashboard/bookings");
    revalidatePath(`/dashboard/bookings/${parsed.data.bookingId}`);
    revalidatePath("/dashboard/sales");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "refundBookingAction", userId: authz.userId }),
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
    return {
      error: toActionError(error, { action: "checkInByTokenAction", userId: authz.userId }),
    };
  }
}

// Settle-bill (pay-at-venue gap fix): records payment for a booking
// that was created unpaid (createBookingAction, above, no longer
// collects a payment method up front). requireEmployeeForSaleWithShift
// Bypass, not just requireBookingsManage — this creates a Sale, same
// employee-with-open-shift requirement every Sale-creating action in
// this app has (see lib/action-auth.ts's own comment). Reported live:
// the Owner settling a booking from outside the front desk was blocked
// on "start a shift" — SALES_CREATE_WITHOUT_SHIFT-holders now fall
// through to a synthetic non-cash-drawer shift instead.
export async function settleBookingAction(input: SettleBookingInput): Promise<BookingActionState> {
  const authz = await requireEmployeeForSaleWithShiftBypass(
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
      {
        employeeId: authz.employeeId,
        shiftId: authz.shiftId,
        paymentMethodId: parsed.data.paymentMethodId,
      },
      authz.userId,
      parsed.data.receipt
        ? {
            fileName: parsed.data.receipt.fileName,
            contentType: parsed.data.receipt.contentType,
            data: Buffer.from(parsed.data.receipt.dataBase64, "base64"),
          }
        : undefined,
    );
    revalidatePath("/dashboard/bookings");
    revalidatePath(`/dashboard/bookings/${parsed.data.bookingId}`);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "settleBookingAction", userId: authz.userId }) };
  }
}

// "Sometimes customer change their mind... rather play in further court",
// extended on 2026-08-25 to the time as well. Replaced the court-only
// changeBookingCourtAction, removed once nothing referenced it.
//
// Plain requireBookingsManage, not requireEmployeeWithOpenShift: moving a
// booking never moves money. It cannot even change the amount on a paid
// booking — changeBookingSlot refuses any move that would — so this is
// not a money-moving action the way settleBookingAction is.
export async function changeBookingSlotAction(
  input: ChangeBookingSlotInput,
): Promise<BookingActionState> {
  const authz = await requireBookingsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = changeBookingSlotSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await bookingService.changeBookingSlot(
      parsed.data.bookingId,
      {
        newCourtId: parsed.data.newCourtId,
        newStartAt: parsed.data.newStartAt,
        newEndAt: parsed.data.newEndAt,
      },
      authz.userId,
    );
    revalidatePath("/dashboard/bookings");
    revalidatePath(`/dashboard/bookings/${parsed.data.bookingId}`);
    revalidatePath("/availability");
    return { error: null };
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return { error: error.message, conflict: error.conflict };
    }
    return {
      error: toActionError(error, { action: "changeBookingSlotAction", userId: authz.userId }),
    };
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
