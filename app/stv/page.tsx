import type { Metadata } from "next";

import { computeBusinessDate } from "@/lib/business-date";
import { SpecialOpenPlayTvClient } from "@/features/display/components/special-open-play-tv-client";
import { settingsService } from "@/services/settings/settings.service";
import { specialDisplayService } from "@/services/display/special-display.service";

export const metadata: Metadata = {
  title: "Special Open Play — Now Playing",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Restores a URL the Special Open Play display lost.
//
// It used to render at /tourtv. On 2026-08-15 that route was switched to
// the real tournament display (see app/tourtv/page.tsx's own comment) and
// this screen was left with no route at all — the client component and
// its /api/special-display endpoint stayed fully working, but nothing
// mounted them, so staff had no way to put it on the TV.
//
// /stv rather than reclaiming /tourtv: both displays are live features
// now and the venue runs tournaments as well as special open play, so
// they need separate URLs instead of taking turns on one.
//
// Same shape as /tv and /tourtv — server-fetches the first frame so the
// TV shows real content immediately rather than a loading state, then
// the client polls /api/special-display from there.
export default async function SpecialOpenPlayTvPage() {
  const courtHours = await settingsService.getCourtHours();

  // The business date, not today's calendar date. A special open play
  // night running past midnight must keep showing the night it belongs
  // to rather than flipping to an empty tomorrow at 00:00 — the same
  // rollover rule the rest of the app uses.
  const businessDate = computeBusinessDate(new Date(), courtHours.businessDateRolloverHour);

  const [initialData, announcementRepeatCount, announcementVoice, refreshIntervalSeconds] =
    await Promise.all([
      specialDisplayService.getDisplayData(businessDate),
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
