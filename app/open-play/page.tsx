import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PUBLIC_VISIBILITY_KEYS } from "@/lib/public-visibility";
import { openPlaySessionService } from "@/services/open-play/session.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Open Play",
  description: "Upcoming Open Play sessions at The Courtroom.",
};

export const dynamic = "force-dynamic";

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

export default async function OpenPlayPage() {
  const visibility = await settingsService.getPublicVisibility();

  if (!visibility[PUBLIC_VISIBILITY_KEYS.OPEN_PLAY]) {
    return (
      <div className="flex min-h-svh flex-1 flex-col">
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Open Play</h1>
          <p className="text-muted-foreground">Open Play details aren&apos;t available online right now.</p>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const sessions = await openPlaySessionService.listSessions({ status: "SCHEDULED" });

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
        <div>
          <h1 className="font-heading text-4xl font-semibold tracking-tight">Open Play</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Drop in, rotate, and play with other members.
          </p>
        </div>

        {sessions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No upcoming sessions scheduled right now.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {sessions.map((session) => (
              <div key={session.id} className="flex flex-col gap-1 rounded-xl border p-4">
                <p className="font-heading font-semibold">{session.title ?? "Open Play"}</p>
                <p className="text-muted-foreground text-sm">
                  {dateTimeFormatter.format(session.startAt)} – {dateTimeFormatter.format(session.endAt)}
                </p>
                <p className="text-muted-foreground text-sm">Capacity: {session.capacity}</p>
              </div>
            ))}
          </div>
        )}

        <p className="text-muted-foreground text-sm">
          Visit us or contact the front desk to register for an Open Play session.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
