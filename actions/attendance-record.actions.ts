"use server";

import { revalidatePath } from "next/cache";

import {
  correctAttendanceEntrySchema,
  createManualAttendanceEntrySchema,
  type CorrectAttendanceEntryInput,
  type CreateManualAttendanceEntryInput,
} from "@/features/payroll/schemas/attendance-record.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { attendanceRecordService } from "@/services/payroll/attendance-record.service";
import { PERMISSIONS } from "@/types/permissions";

export interface AttendanceRecordActionState {
  error: string | null;
}

function requirePayrollManage() {
  return requirePermission(
    PERMISSIONS.PAYROLL_MANAGE,
    "You don't have permission to manage payroll.",
  );
}

function revalidatePayroll(): void {
  revalidatePath("/dashboard/payroll");
}

export async function createManualAttendanceEntryAction(
  input: CreateManualAttendanceEntryInput,
): Promise<AttendanceRecordActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createManualAttendanceEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid entry." };
  }

  try {
    await attendanceRecordService.createManualEntry(parsed.data, authz.userId);
    revalidatePayroll();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "createManualAttendanceEntryAction",
        userId: authz.userId,
      }),
    };
  }
}

export async function correctAttendanceEntryAction(
  input: CorrectAttendanceEntryInput,
): Promise<AttendanceRecordActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = correctAttendanceEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid correction." };
  }

  try {
    await attendanceRecordService.correctEntry(parsed.data, authz.userId);
    revalidatePayroll();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "correctAttendanceEntryAction", userId: authz.userId }),
    };
  }
}
