"use server";

import { revalidatePath } from "next/cache";

import {
  addBookingProductLineItemInputSchema,
  settleBookingTabInputSchema,
  voidBookingTabLineItemInputSchema,
  writeOffBookingTabInputSchema,
  type AddBookingProductLineItemInput,
  type SettleBookingTabInput,
  type VoidBookingTabLineItemInput,
  type WriteOffBookingTabInput,
} from "@/features/bookings/schemas/booking-tab.schema";
import {
  requireEmployee,
  requireEmployeeWithOpenShift,
  requirePermission,
} from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { bookingTabService } from "@/services/booking/booking-tab.service";
import { PERMISSIONS } from "@/types/permissions";

export interface BookingTabActionState {
  error: string | null;
}

function requireBookingsManage() {
  return requirePermission(
    PERMISSIONS.BOOKINGS_MANAGE,
    "You don't have permission to manage bookings.",
  );
}

function revalidateBooking(bookingId: string): void {
  revalidatePath(`/dashboard/bookings/${bookingId}`);
  revalidatePath("/dashboard/sales");
}

export async function addBookingProductLineItemAction(
  input: AddBookingProductLineItemInput,
): Promise<BookingTabActionState> {
  const authz = await requireBookingsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = addBookingProductLineItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await bookingTabService.addProductLineItem(
      parsed.data.bookingId,
      parsed.data.productId,
      parsed.data.qty,
      authz.userId,
    );
    revalidateBooking(parsed.data.bookingId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "addBookingProductLineItemAction",
        userId: authz.userId,
      }),
    };
  }
}

export async function voidBookingTabLineItemAction(
  input: VoidBookingTabLineItemInput,
): Promise<BookingTabActionState> {
  const authz = await requireBookingsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = voidBookingTabLineItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await bookingTabService.voidLineItem(
      parsed.data.bookingId,
      parsed.data.lineItemId,
      parsed.data.reason,
      authz.userId,
    );
    revalidateBooking(parsed.data.bookingId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "voidBookingTabLineItemAction", userId: authz.userId }),
    };
  }
}

// Settlement is revenue-producing — needs an Employee + currently open
// Shift, same as every other Sale-creating action in this app.
export async function settleBookingTabAction(
  input: SettleBookingTabInput,
): Promise<BookingTabActionState> {
  const authz = await requireEmployeeWithOpenShift(
    PERMISSIONS.BOOKINGS_MANAGE,
    "You don't have permission to settle booking add-ons.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = settleBookingTabInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await bookingTabService.settleTab(
      parsed.data.bookingId,
      parsed.data.method,
      parsed.data.gcashReference ?? null,
      {
        employeeId: authz.employeeId,
        shiftId: authz.shiftId,
        paymentMethodId: parsed.data.paymentMethodId,
      },
      authz.userId,
    );
    revalidateBooking(parsed.data.bookingId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "settleBookingTabAction", userId: authz.userId }),
    };
  }
}

export async function writeOffBookingTabAction(
  input: WriteOffBookingTabInput,
): Promise<BookingTabActionState> {
  const authz = await requireEmployee(
    PERMISSIONS.BOOKINGS_MANAGE,
    "You don't have permission to write off booking add-ons.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = writeOffBookingTabInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await bookingTabService.writeOffTab(
      parsed.data.bookingId,
      parsed.data.reason,
      authz.employeeId,
      authz.userId,
    );
    revalidateBooking(parsed.data.bookingId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "writeOffBookingTabAction", userId: authz.userId }),
    };
  }
}
