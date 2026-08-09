import type { Metadata } from "next";

import { SpecialOpenPlayTvClient } from "@/features/display/components/special-open-play-tv-client";
import { settingsService } from "@/services/settings/settings.service";
import { specialDisplayService } from "@/services/display/special-display.service";

export const metadata: Metadata = {
  title: "Special Open Play — Now Playing",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Owner request (2026-08-09): "ill use the /tourtv url and reuse it
// after" — this route is TEMPORARILY repurposed to show the Special
// Open Play display instead of the tournament one, for as long as the
// outside special court is running. The real tournament display code
// (tournamentDisplayService, TournamentTvDisplayClient,
// /api/tournament-display) is untouched and still fully working — only
// THIS page's own render target changed. To switch back: swap the
// import/JSX below back to tournamentDisplayService +
// TournamentTvDisplayClient (see git history for the exact prior
// version of this file), and revert the metadata title.
export default async function TourTvPage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [initialData, announcementRepeatCount, announcementVoice, refreshIntervalSeconds] =
    await Promise.all([
      specialDisplayService.getDisplayData(today),
      settingsService.getAnnouncementRepeatCount(),
      settingsService.getAnnouncementVoice(),
      settingsService.getDisplayRefreshIntervalSeconds(),
    ]);

  return (
    <SpecialOpenPlayTvClient
      initialData={initialData}
      announcementRepeatCount={announcementRepeatCount}
      announcementVoice={announcementVoice}
      refreshIntervalSeconds={refreshIntervalSeconds}
    />
  );
}
