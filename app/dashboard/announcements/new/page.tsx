import type { Metadata } from "next";

import { AnnouncementForm } from "@/features/notifications/components/announcement-form";

export const metadata: Metadata = {
  title: "New Announcement",
};

// No permission check needed here — middleware (lib/rbac.ts) already
// requires system:admin for this exact route before the page renders.
export default function NewAnnouncementPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New announcement</h1>
        <p className="text-muted-foreground text-sm">
          Create a draft, then publish it to notify every user.
        </p>
      </div>
      <AnnouncementForm />
    </div>
  );
}
