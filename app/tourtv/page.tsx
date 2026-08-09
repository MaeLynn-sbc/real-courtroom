import type { Metadata } from "next";

import { TournamentTvDisplayClient } from "@/features/display/components/tournament-tv-display-client";
import { settingsService } from "@/services/settings/settings.service";
import { tournamentDisplayService } from "@/services/display/tournament-display.service";

export const metadata: Metadata = {
  title: "Tournament — Now Playing",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Fixed, memorable public URL, same shape as app/tv/page.tsx — no gate,
// for typing on a TV's on-screen remote keyboard. Reuses the same
// announcement voice/repeat-count/refresh-interval settings as the Open
// Play TV — one shared "how the venue's TV sounds" configuration, not a
// second one to keep in sync.
export default async function TourTvPage() {
  const [initialData, announcementRepeatCount, announcementVoice, refreshIntervalSeconds] =
    await Promise.all([
      tournamentDisplayService.getDisplayData(),
      settingsService.getAnnouncementRepeatCount(),
      settingsService.getAnnouncementVoice(),
      settingsService.getDisplayRefreshIntervalSeconds(),
    ]);

  return (
    <TournamentTvDisplayClient
      initialData={initialData}
      announcementRepeatCount={announcementRepeatCount}
      announcementVoice={announcementVoice}
      refreshIntervalSeconds={refreshIntervalSeconds}
    />
  );
}
