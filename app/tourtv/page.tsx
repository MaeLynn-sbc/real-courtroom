import type { Metadata } from "next";

import { TournamentTvDisplayClient } from "@/features/display/components/tournament-tv-display-client";
import { settingsService } from "@/services/settings/settings.service";
import { tournamentDisplayService } from "@/services/display/tournament-display.service";

export const metadata: Metadata = {
  title: "Tournament — Now Playing",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Owner request (2026-08-15): switched back from the temporary Special
// Open Play repurposing (see git history around 2026-08-09) — this is a
// real tournament now, and TournamentTvDisplayClient has no game
// timer/countdown at all (see its own comment), matching the explicit
// "no timer needed" ask. The Special Open Play display code is untouched
// and still fully working, just no longer this route's render target.
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
