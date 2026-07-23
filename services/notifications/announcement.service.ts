import type { Announcement } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { notificationService } from "@/services/notifications/notification.service";

interface CreateAnnouncementInput {
  title: string;
  body: string;
  expiresAt?: Date;
}

interface UpdateAnnouncementInput {
  title?: string;
  body?: string;
  expiresAt?: Date | null;
}

// Announcements stay their own broadcast list (not fanned out into
// Notification rows for the list itself — see /dashboard/announcements),
// but publishing one also creates a personal ANNOUNCEMENT notification per
// active user via notificationService.createAnnouncementNotifications, so
// it surfaces in the Notification Center too.
export class AnnouncementService {
  async listPublished(): Promise<Announcement[]> {
    const now = new Date();
    return prisma.announcement.findMany({
      where: {
        isPublished: true,
        deletedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { publishedAt: "desc" },
    });
  }

  async listAll(): Promise<Announcement[]> {
    return prisma.announcement.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
  }

  async getById(announcementId: string): Promise<Announcement> {
    return prisma.announcement.findUniqueOrThrow({ where: { id: announcementId } });
  }

  async create(input: CreateAnnouncementInput, actorUserId: string): Promise<Announcement> {
    return prisma.announcement.create({
      data: {
        title: input.title,
        body: input.body,
        expiresAt: input.expiresAt,
        createdById: actorUserId,
      },
    });
  }

  async update(announcementId: string, input: UpdateAnnouncementInput): Promise<Announcement> {
    return prisma.announcement.update({
      where: { id: announcementId },
      data: { title: input.title, body: input.body, expiresAt: input.expiresAt },
    });
  }

  async publish(announcementId: string): Promise<Announcement> {
    const announcement = await prisma.announcement.update({
      where: { id: announcementId },
      data: { isPublished: true, publishedAt: new Date() },
    });

    await notificationService.createAnnouncementNotifications(announcementId);

    return announcement;
  }

  async unpublish(announcementId: string): Promise<Announcement> {
    return prisma.announcement.update({
      where: { id: announcementId },
      data: { isPublished: false },
    });
  }

  async softDelete(announcementId: string): Promise<Announcement> {
    return prisma.announcement.update({
      where: { id: announcementId },
      data: { deletedAt: new Date() },
    });
  }
}

export const announcementService = new AnnouncementService();
