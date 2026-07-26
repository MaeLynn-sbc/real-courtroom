"use server";

import { revalidatePath } from "next/cache";

import {
  changeRoleSchema,
  createEmployeeSchema,
  setActiveSchema,
  setCoachSchema,
  updateEmployeeSchema,
  type ChangeRoleInput,
  type CreateEmployeeInput,
  type SetActiveInput,
  type SetCoachInput,
  type UpdateEmployeeInput,
} from "@/features/employees/schemas/employee.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { employeeService } from "@/services/employee/employee.service";
import { PERMISSIONS } from "@/types/permissions";

export interface EmployeeActionState {
  error: string | null;
}

export interface CreateEmployeeActionState extends EmployeeActionState {
  employeeId?: string;
  // Plaintext, one-time — never re-fetchable after this response. The UI
  // must show it now or the admin has to reset the password to see one
  // again (see employee.service.ts's createEmployee comment).
  tempPassword?: string;
}

export interface ResetPasswordActionState extends EmployeeActionState {
  tempPassword?: string;
}

function requireUsersManage() {
  return requirePermission(PERMISSIONS.USERS_MANAGE, "You don't have permission to manage employees.");
}

export async function createEmployeeAction(
  input: CreateEmployeeInput,
): Promise<CreateEmployeeActionState> {
  const authz = await requireUsersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createEmployeeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid employee details." };
  }

  try {
    const { employee, tempPassword } = await employeeService.createEmployee(parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/employees");
    return { error: null, employeeId: employee.id, tempPassword };
  } catch (error) {
    return { error: toActionError(error, { action: "createEmployeeAction", userId: authz.userId }) };
  }
}

export async function updateEmployeeAction(
  employeeId: string,
  input: UpdateEmployeeInput,
): Promise<EmployeeActionState> {
  const authz = await requireUsersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateEmployeeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid employee details." };
  }

  try {
    await employeeService.updateEmployee(employeeId, parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/employees");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "updateEmployeeAction", userId: authz.userId }) };
  }
}

export async function resetEmployeePasswordAction(
  employeeId: string,
): Promise<ResetPasswordActionState> {
  const authz = await requireUsersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    const { tempPassword } = await employeeService.resetPassword(employeeId, authz.userId);
    revalidatePath("/dashboard/admin/employees");
    return { error: null, tempPassword };
  } catch (error) {
    return {
      error: toActionError(error, { action: "resetEmployeePasswordAction", userId: authz.userId }),
    };
  }
}

export async function changeEmployeeRoleAction(
  employeeId: string,
  input: ChangeRoleInput,
): Promise<EmployeeActionState> {
  const authz = await requireUsersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = changeRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Select a role." };
  }

  try {
    await employeeService.changeRole(employeeId, parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/employees");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "changeEmployeeRoleAction", userId: authz.userId }) };
  }
}

export async function setEmployeeActiveAction(
  employeeId: string,
  input: SetActiveInput,
): Promise<EmployeeActionState> {
  const authz = await requireUsersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await employeeService.setActive(employeeId, parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/employees");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setEmployeeActiveAction", userId: authz.userId }) };
  }
}

export async function setEmployeeCoachAction(
  employeeId: string,
  input: SetCoachInput,
): Promise<EmployeeActionState> {
  const authz = await requireUsersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = setCoachSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await employeeService.setCoach(employeeId, parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/employees");
    revalidatePath("/dashboard/coaching");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setEmployeeCoachAction", userId: authz.userId }) };
  }
}
