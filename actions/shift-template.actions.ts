"use server";

import { revalidatePath } from "next/cache";

import {
  createShiftTemplateSchema,
  setShiftTemplateActiveSchema,
  updateShiftTemplateSchema,
  type CreateShiftTemplateInput,
  type SetShiftTemplateActiveInput,
  type UpdateShiftTemplateInput,
} from "@/features/payroll/schemas/shift-template.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { shiftTemplateService } from "@/services/payroll/shift-template.service";
import { PERMISSIONS } from "@/types/permissions";

export interface ShiftTemplateActionState {
  error: string | null;
}

function requirePayrollManage() {
  return requirePermission(
    PERMISSIONS.PAYROLL_MANAGE,
    "You don't have permission to manage payroll.",
  );
}

function revalidateScheduleSettings(): void {
  revalidatePath("/dashboard/payroll/schedule");
  revalidatePath("/dashboard/payroll/schedule/settings");
}

export async function createShiftTemplateAction(
  input: CreateShiftTemplateInput,
): Promise<ShiftTemplateActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createShiftTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid shift." };
  }

  try {
    await shiftTemplateService.createTemplate(parsed.data, authz.userId);
    revalidateScheduleSettings();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "createShiftTemplateAction", userId: authz.userId }) };
  }
}

export async function updateShiftTemplateAction(
  input: UpdateShiftTemplateInput,
): Promise<ShiftTemplateActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateShiftTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid shift." };
  }

  try {
    await shiftTemplateService.updateTemplate(
      parsed.data.templateId,
      { name: parsed.data.name, startTime: parsed.data.startTime, endTime: parsed.data.endTime },
      authz.userId,
    );
    revalidateScheduleSettings();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "updateShiftTemplateAction", userId: authz.userId }) };
  }
}

export async function setShiftTemplateActiveAction(
  input: SetShiftTemplateActiveInput,
): Promise<ShiftTemplateActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = setShiftTemplateActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await shiftTemplateService.setTemplateActive(parsed.data.templateId, parsed.data.active, authz.userId);
    revalidateScheduleSettings();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setShiftTemplateActiveAction", userId: authz.userId }) };
  }
}
