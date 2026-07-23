"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import type { Notification } from "@/lib/generated/prisma/client";
import { notificationService } from "@/services/notifications/notification.service";

export interface NotificationActionState {
  error: string | null;
}

export interface NotificationCenterData {
  notifications: Notification[];
  unreadCount: number;
}

// Notifications need no permission beyond being authenticated — every
// dashboard user (including Members) manages only their own, scoped to
// session.user.id inside notificationService itself.
async function requireSession(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const session = await auth();

  if (!session?.user) {
    return { ok: false, error: "You must be signed in." };
  }

  return { ok: true, userId: session.user.id };
}

function toActionError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export async function getNotificationCenterDataAction(): Promise<NotificationCenterData> {
  const authz = await requireSession();
  if (!authz.ok) {
    return { notifications: [], unreadCount: 0 };
  }

  await notificationService.generateReminders();

  const [notifications, unreadCount] = await Promise.all([
    notificationService.listForUser(authz.userId),
    notificationService.getUnreadCount(authz.userId),
  ]);

  return { notifications, unreadCount };
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<NotificationActionState> {
  const authz = await requireSession();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await notificationService.markRead(notificationId, authz.userId);
    revalidatePath("/dashboard");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error) };
  }
}

export async function markAllNotificationsReadAction(): Promise<NotificationActionState> {
  const authz = await requireSession();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await notificationService.markAllRead(authz.userId);
    revalidatePath("/dashboard");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error) };
  }
}
