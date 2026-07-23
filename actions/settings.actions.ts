"use server";

import { revalidatePath } from "next/cache";

import { upsertSettingSchema, type UpsertSettingInput } from "@/features/settings/schemas/settings.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { settingsService } from "@/services/settings/settings.service";
import { PERMISSIONS } from "@/types/permissions";

export interface SettingsActionState {
  error: string | null;
}

function requireSystemAdmin() {
  return requirePermission(PERMISSIONS.SYSTEM_ADMIN, "You don't have permission to manage settings.");
}

export async function upsertSettingAction(input: UpsertSettingInput): Promise<SettingsActionState> {
  const authz = await requireSystemAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = upsertSettingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid setting." };
  }

  try {
    await settingsService.upsertSetting(parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/settings");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "upsertSettingAction", userId: authz.userId }) };
  }
}

export async function deleteSettingAction(key: string): Promise<SettingsActionState> {
  const authz = await requireSystemAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await settingsService.deleteSetting(key, authz.userId);
    revalidatePath("/dashboard/admin/settings");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "deleteSettingAction", userId: authz.userId }) };
  }
}
