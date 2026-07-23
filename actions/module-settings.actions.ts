"use server";

import { revalidatePath } from "next/cache";

import { requireSystemAdmin } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import type { ModuleKey } from "@/lib/module-flags";
import { settingsService } from "@/services/settings/settings.service";

export interface ModuleSettingsActionState {
  error: string | null;
}

export async function setModuleEnabledAction(
  key: ModuleKey,
  enabled: boolean,
): Promise<ModuleSettingsActionState> {
  const authz = await requireSystemAdmin("You don't have permission to manage modules.");
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await settingsService.setModuleEnabled(key, enabled, authz.userId);
    // Every page that gates a creation flow on this flag needs a fresh
    // read, not just the Settings page itself.
    revalidatePath("/dashboard/admin/settings");
    revalidatePath("/dashboard/players/[playerId]", "page");
    revalidatePath("/dashboard/lockers/[lockerId]", "page");
    revalidatePath("/dashboard/tournaments/[tournamentId]/categories/[categoryId]", "page");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setModuleEnabledAction", userId: authz.userId }) };
  }
}
