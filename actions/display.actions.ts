"use server";

import { revalidatePath } from "next/cache";

import { requireSystemAdmin } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { settingsService } from "@/services/settings/settings.service";

export interface RegenerateDisplaySlugActionState {
  error: string | null;
  slug?: string;
}

// BUILD-SPEC.md §13: "Owner-only 'Regenerate URL' issues a new slug and
// invalidates the old one — for when staff leave or the URL gets
// shared." Staff can otherwise VIEW the setup page freely; only this
// mutation is gated.
export async function regenerateDisplaySlugAction(): Promise<RegenerateDisplaySlugActionState> {
  const authz = await requireSystemAdmin("Only an owner can regenerate the display URL.");
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    const slug = await settingsService.regenerateDisplaySlug(authz.userId);
    revalidatePath("/dashboard/admin/tv-display");
    return { error: null, slug };
  } catch (error) {
    return { error: toActionError(error, { action: "regenerateDisplaySlugAction", userId: authz.userId }) };
  }
}
