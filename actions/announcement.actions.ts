"use server";

import { revalidatePath } from "next/cache";

import {
  createAnnouncementSchema,
  updateAnnouncementSchema,
  type CreateAnnouncementInput,
  type UpdateAnnouncementInput,
} from "@/features/notifications/schemas/notification.schema";
import { requireSystemAdmin } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { announcementService } from "@/services/notifications/announcement.service";

export interface AnnouncementActionState {
  error: string | null;
}

export interface CreateAnnouncementActionState extends AnnouncementActionState {
  announcementId?: string;
}

// Gated by SYSTEM_ADMIN, the existing admin-only permission tier (Owner and
// Manager both hold it) — matches how every other admin-only action in
// this app is gated, rather than introducing a dedicated permission for
// one module.
function requireSystemAdminForAnnouncements() {
  return requireSystemAdmin("You don't have permission to manage announcements.");
}

function revalidateAnnouncements(announcementId?: string): void {
  revalidatePath("/dashboard/announcements");
  if (announcementId) {
    revalidatePath(`/dashboard/announcements/${announcementId}`);
  }
  revalidatePath("/dashboard");
}

export async function createAnnouncementAction(
  input: CreateAnnouncementInput,
): Promise<CreateAnnouncementActionState> {
  const authz = await requireSystemAdminForAnnouncements();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createAnnouncementSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid announcement details." };
  }

  try {
    const announcement = await announcementService.create(parsed.data, authz.userId);
    revalidateAnnouncements();
    return { error: null, announcementId: announcement.id };
  } catch (error) {
    return {
      error: toActionError(error, { action: "createAnnouncementAction", userId: authz.userId }),
    };
  }
}

export async function updateAnnouncementAction(
  announcementId: string,
  input: UpdateAnnouncementInput,
): Promise<AnnouncementActionState> {
  const authz = await requireSystemAdminForAnnouncements();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateAnnouncementSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid announcement details." };
  }

  try {
    await announcementService.update(announcementId, parsed.data);
    revalidateAnnouncements(announcementId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "updateAnnouncementAction", userId: authz.userId }),
    };
  }
}

export async function publishAnnouncementAction(
  announcementId: string,
): Promise<AnnouncementActionState> {
  const authz = await requireSystemAdminForAnnouncements();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await announcementService.publish(announcementId);
    revalidateAnnouncements(announcementId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "publishAnnouncementAction", userId: authz.userId }),
    };
  }
}

export async function unpublishAnnouncementAction(
  announcementId: string,
): Promise<AnnouncementActionState> {
  const authz = await requireSystemAdminForAnnouncements();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await announcementService.unpublish(announcementId);
    revalidateAnnouncements(announcementId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "unpublishAnnouncementAction", userId: authz.userId }),
    };
  }
}

export async function deleteAnnouncementAction(
  announcementId: string,
): Promise<AnnouncementActionState> {
  const authz = await requireSystemAdminForAnnouncements();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await announcementService.softDelete(announcementId);
    revalidateAnnouncements();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "deleteAnnouncementAction", userId: authz.userId }),
    };
  }
}
