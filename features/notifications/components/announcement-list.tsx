"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { deleteAnnouncementAction, publishAnnouncementAction, unpublishAnnouncementAction } from "@/actions/announcement.actions";
import { ConfirmActionButton } from "@/components/shared/confirm-action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Announcement } from "@/lib/generated/prisma/client";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

interface AnnouncementListProps {
  announcements: Announcement[];
  canManage: boolean;
}

export function AnnouncementList({ announcements, canManage }: AnnouncementListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleAction(action: () => Promise<{ error: string | null }>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (announcements.length === 0) {
    return <EmptyState title="No announcements yet." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {announcements.map((announcement) => (
        <div key={announcement.id} className="flex flex-col gap-2 rounded-xl border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link href={`/dashboard/announcements/${announcement.id}`} className="font-medium hover:underline">
                {announcement.title}
              </Link>
              <p className="text-muted-foreground mt-1 text-sm">{announcement.body}</p>
            </div>
            <Badge variant={announcement.isPublished ? "secondary" : "outline"}>
              {announcement.isPublished ? "Published" : "Draft"}
            </Badge>
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
            {announcement.publishedAt ? <span>Published {dateFormatter.format(announcement.publishedAt)}</span> : null}
            {announcement.expiresAt ? <span>Expires {dateFormatter.format(announcement.expiresAt)}</span> : null}
          </div>
          {canManage ? (
            <div className="flex gap-2">
              {announcement.isPublished ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handleAction(() => unpublishAnnouncementAction(announcement.id))}
                >
                  Unpublish
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleAction(() => publishAnnouncementAction(announcement.id))}
                >
                  Publish
                </Button>
              )}
              <ConfirmActionButton
                title="Delete this announcement?"
                description="This removes it from the announcements list and notification center. This can't be undone."
                confirmLabel="Delete"
                disabled={isPending}
                onConfirm={() => handleAction(() => deleteAnnouncementAction(announcement.id))}
              >
                Delete
              </ConfirmActionButton>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
