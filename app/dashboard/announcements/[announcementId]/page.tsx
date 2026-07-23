import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { AnnouncementForm } from "@/features/notifications/components/announcement-form";
import { AnnouncementList } from "@/features/notifications/components/announcement-list";
import { hasPermission } from "@/lib/rbac";
import { announcementService } from "@/services/notifications/announcement.service";
import { PERMISSIONS } from "@/types/permissions";

interface AnnouncementDetailPageProps {
  params: Promise<{ announcementId: string }>;
}

export async function generateMetadata({ params }: AnnouncementDetailPageProps): Promise<Metadata> {
  const { announcementId } = await params;
  try {
    const announcement = await announcementService.getById(announcementId);
    return { title: announcement.title };
  } catch {
    return { title: "Announcement" };
  }
}

export default async function AnnouncementDetailPage({ params }: AnnouncementDetailPageProps) {
  const { announcementId } = await params;
  const [session, announcement] = await Promise.all([
    auth(),
    announcementService.getById(announcementId).catch(() => null),
  ]);

  if (!announcement) {
    notFound();
  }

  const canManage = hasPermission(session?.user.permissions ?? [], PERMISSIONS.SYSTEM_ADMIN);
  if (!announcement.isPublished && !canManage) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{announcement.title}</h1>
      </div>

      <AnnouncementList announcements={[announcement]} canManage={canManage} />

      {canManage ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Edit</h2>
          <AnnouncementForm announcement={announcement} />
        </div>
      ) : null}
    </div>
  );
}
