"use server";

import { revalidatePath } from "next/cache";

import {
  createMarkedDateSchema,
  deleteMarkedDateSchema,
  type CreateMarkedDateInput,
  type DeleteMarkedDateInput,
} from "@/features/payroll/schemas/payroll-marked-date.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { payrollMarkedDateService } from "@/services/payroll/payroll-marked-date.service";
import { PERMISSIONS } from "@/types/permissions";

export interface MarkedDateActionState {
  error: string | null;
}

function requirePayrollManage() {
  return requirePermission(
    PERMISSIONS.PAYROLL_MANAGE,
    "You don't have permission to manage payroll.",
  );
}

function revalidateMarkedDates(): void {
  revalidatePath("/dashboard/payroll/marked-dates");
}

export async function createMarkedDateAction(
  input: CreateMarkedDateInput,
): Promise<MarkedDateActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createMarkedDateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid date." };
  }

  try {
    await payrollMarkedDateService.createMarkedDate(parsed.data.date, parsed.data.label, authz.userId);
    revalidateMarkedDates();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "createMarkedDateAction", userId: authz.userId }) };
  }
}

export async function deleteMarkedDateAction(
  input: DeleteMarkedDateInput,
): Promise<MarkedDateActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = deleteMarkedDateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await payrollMarkedDateService.deleteMarkedDate(parsed.data.markedDateId);
    revalidateMarkedDates();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "deleteMarkedDateAction", userId: authz.userId }) };
  }
}
