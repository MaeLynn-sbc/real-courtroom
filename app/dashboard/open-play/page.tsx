import { PlusCircle, Repeat } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { SessionList } from "@/features/open-play/components/session-list";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { openPlaySessionService } from "@/services/open-play/session.service";

export const metadata: Metadata = {
  title: "Open Play",
};

// See app/dashboard/bookings/new/page.tsx's comment — same static-
// prerendering trap.
export const dynamic = "force-dynamic";

export default async function OpenPlayPage() {
  if (!isFeatureEnabled("openPlay")) {
    return (
      <EmptyState
        icon={Repeat}
        title="Open Play isn't enabled"
        description="Set FEATURE_OPEN_PLAY=true to enable this module."
      />
    );
  }

  const sessions = await openPlaySessionService.listSessions();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Open Play</h1>
          <p className="text-muted-foreground text-sm">
            Schedule sessions and run the live Waiting/Playing/Resting rotation.
          </p>
        </div>
        <Link href="/dashboard/open-play/new" className={buttonVariants()}>
          <PlusCircle className="size-4" aria-hidden="true" />
          New session
        </Link>
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="No Open Play sessions yet"
          description="Create a session to start registering players."
        />
      ) : (
        <SessionList sessions={sessions} />
      )}
    </div>
  );
}
