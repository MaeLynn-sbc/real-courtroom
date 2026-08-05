"use server";

import { revalidatePath } from "next/cache";

import {
  assignDaySchema,
  bulkAssignSchema,
  clearDaySchema,
  type AssignDayFormInput,
  type BulkAssignInput,
  type ClearDayInput,
} from "@/features/payroll/schemas/schedule-assignment.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { scheduleAssignmentService } from "@/services/payroll/schedule-assignment.service";
import { PERMISSIONS } from "@/types/permissions";

export interface ScheduleAssignmentActionState {
  error: string | null;
}

function requirePayrollManage() {
  return requirePermission(
    PERMISSIONS.PAYROLL_MANAGE,
    "You don't have permission to manage payroll.",
  );
}

function revalidateSchedule(): void {
  revalidatePath("/dashboard/payroll/schedule");
}

export async function assignDayAction(
  input: AssignDayFormInput,
): Promise<ScheduleAssignmentActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = assignDaySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid assignment." };
  }

  try {
    // The refine above already guarantees exactly one of the two shapes
    // (templateId XOR scheduledStart+scheduledEnd) — this re-narrows for
    // the service's own discriminated union, which the flat form schema
    // can't express directly.
    if (parsed.data.templateId) {
      await scheduleAssignmentService.assignDay(
        {
          employeeId: parsed.data.employeeId,
          workDate: parsed.data.workDate,
          templateId: parsed.data.templateId,
          note: parsed.data.note,
        },
        authz.userId,
      );
    } else {
      await scheduleAssignmentService.assignDay(
        {
          employeeId: parsed.data.employeeId,
          workDate: parsed.data.workDate,
          scheduledStart: parsed.data.scheduledStart!,
          scheduledEnd: parsed.data.scheduledEnd!,
          note: parsed.data.note,
        },
        authz.userId,
      );
    }
    revalidateSchedule();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "assignDayAction", userId: authz.userId }) };
  }
}

export async function clearDayAction(input: ClearDayInput): Promise<ScheduleAssignmentActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = clearDaySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await scheduleAssignmentService.clearDay(parsed.data.employeeId, parsed.data.workDate, authz.userId);
    revalidateSchedule();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "clearDayAction", userId: authz.userId }) };
  }
}

export async function bulkAssignAction(
  input: BulkAssignInput,
): Promise<ScheduleAssignmentActionState & { dayCount?: number }> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = bulkAssignSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid range." };
  }

  try {
    const result = await scheduleAssignmentService.bulkAssign(parsed.data, authz.userId);
    revalidateSchedule();
    return { error: null, dayCount: result.dayCount };
  } catch (error) {
    return { error: toActionError(error, { action: "bulkAssignAction", userId: authz.userId }) };
  }
}
