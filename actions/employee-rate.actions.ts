"use server";

import { revalidatePath } from "next/cache";

import {
  createEmployeeRateSchema,
  deleteEmployeeRateSchema,
  updateEmployeeRateSchema,
  type CreateEmployeeRateInput,
  type DeleteEmployeeRateInput,
  type UpdateEmployeeRateInput,
} from "@/features/payroll/schemas/employee-rate.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { employeeRateService } from "@/services/payroll/employee-rate.service";
import { PERMISSIONS } from "@/types/permissions";

export interface EmployeeRateActionState {
  error: string | null;
}

function requirePayrollManage() {
  return requirePermission(
    PERMISSIONS.PAYROLL_MANAGE,
    "You don't have permission to manage payroll.",
  );
}

function revalidateRates(): void {
  revalidatePath("/dashboard/payroll/rates");
}

export async function createEmployeeRateAction(
  input: CreateEmployeeRateInput,
): Promise<EmployeeRateActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createEmployeeRateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid rate." };
  }

  try {
    await employeeRateService.createRate(parsed.data, authz.userId);
    revalidateRates();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "createEmployeeRateAction", userId: authz.userId }) };
  }
}

export async function updateEmployeeRateAction(
  input: UpdateEmployeeRateInput,
): Promise<EmployeeRateActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateEmployeeRateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid rate." };
  }

  try {
    await employeeRateService.updateRate(
      parsed.data.rateId,
      { dailyRateCents: parsed.data.dailyRateCents, effectiveFrom: parsed.data.effectiveFrom, note: parsed.data.note },
      authz.userId,
    );
    revalidateRates();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "updateEmployeeRateAction", userId: authz.userId }) };
  }
}

export async function deleteEmployeeRateAction(
  input: DeleteEmployeeRateInput,
): Promise<EmployeeRateActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = deleteEmployeeRateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await employeeRateService.deleteLatestRate(parsed.data.rateId, authz.userId);
    revalidateRates();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "deleteEmployeeRateAction", userId: authz.userId }) };
  }
}
