"use server";

import { revalidatePath } from "next/cache";

import {
  endShiftSchema,
  manualSaleInputSchema,
  startShiftSchema,
  type EndShiftInput,
  type ManualSaleInput,
  type StartShiftInput,
} from "@/features/shifts/schemas/shift.schema";
import { requireEmployeeWithOpenShift, requireSession } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { saleService } from "@/services/sales/sale.service";
import { shiftService } from "@/services/shift/shift.service";
import { PERMISSIONS } from "@/types/permissions";

export interface ShiftActionState {
  error: string | null;
}

// Self-service: any signed-in employee manages their own shift, not a
// manage-permission — resolves the caller's Employee row from their own
// session rather than trusting a client-supplied employeeId.
async function requireOwnEmployee() {
  const authz = await requireSession();
  if (!authz.ok) {
    return authz;
  }

  const employee = await prisma.employee.findUnique({ where: { userId: authz.userId } });
  if (!employee) {
    return { ok: false as const, error: "No employee profile is linked to this account." };
  }

  return { ok: true as const, userId: authz.userId, employeeId: employee.id };
}

export async function startShiftAction(input: StartShiftInput): Promise<ShiftActionState> {
  const authz = await requireOwnEmployee();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = startShiftSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid shift details." };
  }

  try {
    await shiftService.startShift(authz.employeeId, parsed.data, authz.userId);
    revalidatePath("/dashboard/shift");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "startShiftAction", userId: authz.userId }) };
  }
}

export async function endShiftAction(
  shiftId: string,
  input: EndShiftInput,
): Promise<ShiftActionState> {
  const authz = await requireOwnEmployee();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = endShiftSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid shift details." };
  }

  try {
    await shiftService.endShift(shiftId, parsed.data, authz.userId);
    revalidatePath("/dashboard/shift");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "endShiftAction", userId: authz.userId }) };
  }
}

// Reported live: cash that comes in outside every modelled revenue flow
// (a booking, a product sale, a settled tab, ...) had nowhere to go —
// SaleCategory.OTHER existed in the schema for exactly this, but nothing
// ever created one, so staff recorded it on paper instead. category is
// hardcoded to OTHER here, not caller-supplied — the schema comment on
// Sale.description is explicit that only PRODUCT/OTHER are designed to
// carry a Sale with no linked source row; letting this action tag an
// entry as BOOKING or MEMBERSHIP would silently corrupt any report that
// expects a Sale in that category to have a matching linked record.
export async function recordManualSaleAction(input: ManualSaleInput): Promise<ShiftActionState> {
  const authz = await requireEmployeeWithOpenShift(
    PERMISSIONS.SALES_RECORD_MANUAL,
    "You don't have permission to record a manual sale.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = manualSaleInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid entry." };
  }

  try {
    // No dedicated gcashReference column on Sale (every other category's
    // reference, where one exists, lives on that category's own linked
    // record) — folded into notes instead, same "free text is the whole
    // record" reasoning the note field itself exists for.
    const notes = parsed.data.gcashReference?.trim()
      ? `GCash ref: ${parsed.data.gcashReference.trim()} — ${parsed.data.note}`
      : parsed.data.note;

    const sale = await saleService.createSale({
      category: "OTHER",
      amountCents: parsed.data.amountCents,
      paymentMethodId: parsed.data.paymentMethodId,
      employeeId: authz.employeeId,
      shiftId: authz.shiftId,
      description: "Manual sale",
      notes,
    });
    await saleService.logSaleCreated(sale, authz.userId);
    revalidatePath("/dashboard/shift");
    revalidatePath("/dashboard/sales");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "recordManualSaleAction", userId: authz.userId }) };
  }
}
