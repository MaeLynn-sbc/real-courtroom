"use server";

import { revalidatePath } from "next/cache";

import { requirePermission, requireSystemAdmin } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { settingsService } from "@/services/settings/settings.service";
import { PERMISSIONS } from "@/types/permissions";

// Operational TV display settings (voice, repeat count, flash duration,
// refresh interval) — reported live: gated on SYSTEM_ADMIN (owner-only)
// even though the person who needs to change them is whoever's
// physically at the display, usually a front-desk attendant, not the
// owner. DISPLAY_MANAGE is its own permission (types/permissions.ts),
// granted to OWNER/MANAGER/RECEPTIONIST by default, reassignable via the
// Roles screen — deliberately narrower than DASHBOARD_ACCESS (which
// every role including MEMBER holds) so this doesn't over-grant to
// non-staff accounts. regenerateDisplaySlugAction, below, is NOT part of
// this — the slug is the display's own auth token and stays
// SYSTEM_ADMIN-gated.
function requireDisplayManage(deniedMessage: string) {
  return requirePermission(PERMISSIONS.DISPLAY_MANAGE, deniedMessage);
}

export interface RegenerateDisplaySlugActionState {
  error: string | null;
  slug?: string;
}

export interface SetAnnouncementRepeatCountActionState {
  error: string | null;
}

export interface SetTimeUpFlashDurationActionState {
  error: string | null;
}

export interface SetAnnouncementVoiceActionState {
  error: string | null;
}

export interface SetDisplayRefreshIntervalActionState {
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

// 5-120s is a sanity bound — below 5s risks hammering the server for no
// real benefit (nothing on screen changes faster than staff/players can
// react anyway), above 2 minutes stops being a "live" display in any
// meaningful sense.
export async function setDisplayRefreshIntervalAction(
  value: number,
): Promise<SetDisplayRefreshIntervalActionState> {
  const authz = await requireDisplayManage("You don't have permission to change the display refresh interval.");
  if (!authz.ok) {
    return { error: authz.error };
  }

  if (!Number.isInteger(value) || value < 5 || value > 120) {
    return { error: "Refresh interval must be a whole number of seconds between 5 and 120." };
  }

  try {
    await settingsService.setDisplayRefreshIntervalSeconds(value, authz.userId);
    revalidatePath("/dashboard/admin/tv-display");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setDisplayRefreshIntervalAction", userId: authz.userId }) };
  }
}

// 1-5 is a sanity bound, not a real product constraint: 1 means "don't
// repeat" (the setting's own stated purpose — go back to once without a
// code change), and there's no legitimate reason to ever want more than
// a handful of repeats of the same announcement.
export async function setAnnouncementRepeatCountAction(value: number): Promise<SetAnnouncementRepeatCountActionState> {
  const authz = await requireDisplayManage("You don't have permission to change the announcement repeat count.");
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

// 30-600s (30s to 10 minutes) is a sanity bound — long enough to
// actually be noticed (below 30s risks nobody looking at exactly the
// right moment), short enough it can never functionally become "flash
// all night."
export async function setTimeUpFlashDurationAction(value: number): Promise<SetTimeUpFlashDurationActionState> {
  const authz = await requireDisplayManage("You don't have permission to change the time's-up flash duration.");
  if (!authz.ok) {
    return { error: authz.error };
  }

  if (!Number.isInteger(value) || value < 30 || value > 600) {
    return { error: "Flash duration must be a whole number of seconds between 30 and 600." };
  }

  try {
    await settingsService.setTimeUpFlashDurationSeconds(value, authz.userId);
    revalidatePath("/dashboard/admin/tv-display");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setTimeUpFlashDurationAction", userId: authz.userId }) };
  }
}

// name+lang, not the whole SpeechSynthesisVoice object — that object
// also carries non-serializable/browser-internal bits and voiceURI,
// which this app deliberately doesn't rely on (see settings.service.ts's
// own comment on why name+lang is the identifying pair, not voiceURI).
// null clears the preference back to "no preference set" (today's
// default: browser picks). No further validation here — matching by
// name is inherently best-effort across devices (see the TV client's
// own graceful fallback when the saved name isn't installed on its
// device), so whoever picks a name their OWN browser offered has done
// as much validation as this can meaningfully do — and per DISPLAY_MANAGE's
// own reasoning, that's usually the attendant at the TV, not the owner,
// since voices belong to that specific machine.
export async function setAnnouncementVoiceAction(
  value: { name: string; lang: string } | null,
): Promise<SetAnnouncementVoiceActionState> {
  const authz = await requireDisplayManage("You don't have permission to change the announcement voice.");
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await settingsService.setAnnouncementVoice(value, authz.userId);
    revalidatePath("/dashboard/admin/tv-display");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setAnnouncementVoiceAction", userId: authz.userId }) };
  }
}
