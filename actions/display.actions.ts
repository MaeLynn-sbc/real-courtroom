"use server";

import { revalidatePath } from "next/cache";

import { requireSystemAdmin } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { settingsService } from "@/services/settings/settings.service";

export interface RegenerateDisplaySlugActionState {
  error: string | null;
  slug?: string;
}

export interface SetAnnouncementRepeatCountActionState {
  error: string | null;
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

// Same owner-only gate as regenerating the URL above — this affects a
// live kiosk display, not a personal preference. 1-5 is a sanity bound,
// not a real product constraint: 1 means "don't repeat" (the setting's
// own stated purpose — go back to once without a code change), and
// there's no legitimate reason to ever want more than a handful of
// repeats of the same announcement.
export async function setAnnouncementRepeatCountAction(value: number): Promise<SetAnnouncementRepeatCountActionState> {
  const authz = await requireSystemAdmin("Only an owner can change the announcement repeat count.");
  if (!authz.ok) {
    return { error: authz.error };
  }

  if (!Number.isInteger(value) || value < 1 || value > 5) {
    return { error: "Repeat count must be a whole number between 1 and 5." };
  }

  try {
    await settingsService.setAnnouncementRepeatCount(value, authz.userId);
    revalidatePath("/dashboard/admin/tv-display");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setAnnouncementRepeatCountAction", userId: authz.userId }) };
  }
}
