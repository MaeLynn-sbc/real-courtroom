"use server";

import { revalidatePath } from "next/cache";

import {
  changeRoleSchema,
  createEmployeeSchema,
  resetPasswordSchema,
  setActiveSchema,
  updateEmployeeSchema,
  type ChangeRoleInput,
  type CreateEmployeeInput,
  type ResetPasswordInput,
  type SetActiveInput,
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
    const employee = await employeeService.createEmployee(parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/employees");
    return { error: null, employeeId: employee.id };
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
  input: ResetPasswordInput,
): Promise<EmployeeActionState> {
  const authz = await requireUsersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid password." };
  }

  try {
    await employeeService.resetPassword(employeeId, parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/employees");
    return { error: null };
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
