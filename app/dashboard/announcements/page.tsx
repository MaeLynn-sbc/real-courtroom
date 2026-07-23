import { Megaphone, PlusCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { AnnouncementList } from "@/features/notifications/components/announcement-list";
import { hasPermission } from "@/lib/rbac";
import { announcementService } from "@/services/notifications/announcement.service";
import { PERMISSIONS } from "@/types/permissions";

export const metadata: Metadata = {
  title: "Announcements",
};

export default async function AnnouncementsPage() {
  const session = await auth();
  const canManage = hasPermission(session?.user.permissions ?? [], PERMISSIONS.SYSTEM_ADMIN);

  const announcements = canManage
    ? await announcementService.listAll()
    : await announcementService.listPublished();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Announcements</h1>
          <p className="text-muted-foreground text-sm">Facility-wide announcements and notices.</p>
        </div>
        {canManage ? (
          <Link href="/dashboard/announcements/new" className={buttonVariants()}>
            <PlusCircle className="size-4" aria-hidden="true" />
            New announcement
          </Link>
        ) : null}
      </div>

      {announcements.length === 0 ? (
        <EmptyState icon={Megaphone} title="No announcements yet" description="Check back later." />
      ) : (
        <AnnouncementList announcements={announcements} canManage={canManage} />
      )}
    </div>
  );
}
