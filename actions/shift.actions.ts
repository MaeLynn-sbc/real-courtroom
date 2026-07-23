"use server";

import { revalidatePath } from "next/cache";

import {
  endShiftSchema,
  startShiftSchema,
  type EndShiftInput,
  type StartShiftInput,
} from "@/features/shifts/schemas/shift.schema";
import { requireSession } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { shiftService } from "@/services/shift/shift.service";

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
