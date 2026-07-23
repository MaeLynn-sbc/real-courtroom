"use server";

import { revalidatePath } from "next/cache";

import {
  createRoleSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type UpdateRoleInput,
} from "@/features/roles/schemas/role.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { roleService } from "@/services/role/role.service";
import { PERMISSIONS } from "@/types/permissions";

export interface RoleActionState {
  error: string | null;
}

export interface CreateRoleActionState extends RoleActionState {
  roleId?: string;
}

function requireUsersManage() {
  return requirePermission(PERMISSIONS.USERS_MANAGE, "You don't have permission to manage roles.");
}

export async function createRoleAction(input: CreateRoleInput): Promise<CreateRoleActionState> {
  const authz = await requireUsersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid role details." };
  }

  try {
    const role = await roleService.createRole(parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/roles");
    return { error: null, roleId: role.id };
  } catch (error) {
    return { error: toActionError(error, { action: "createRoleAction", userId: authz.userId }) };
  }
}

export async function updateRoleAction(
  roleId: string,
  input: UpdateRoleInput,
): Promise<RoleActionState> {
  const authz = await requireUsersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid role details." };
  }

  try {
    await roleService.updateRole(roleId, parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/roles");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "updateRoleAction", userId: authz.userId }) };
  }
}

export async function deleteRoleAction(roleId: string): Promise<RoleActionState> {
  const authz = await requireUsersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await roleService.deleteRole(roleId, authz.userId);
    revalidatePath("/dashboard/admin/roles");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "deleteRoleAction", userId: authz.userId }) };
  }
}
