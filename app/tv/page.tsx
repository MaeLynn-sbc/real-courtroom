import type { Metadata } from "next";

import { TvDisplayClient } from "@/features/display/components/tv-display-client";
import { displayService } from "@/services/display/display.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Court Status",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Fixed, memorable alternative to /display/[slug] — for typing on a TV's
// on-screen remote keyboard, where the unguessable slug (and even a
// shortened one) is still real friction. This route has NO gate at
// all, unlike [slug] — same underlying data either way (already
// public-safe by construction, see app/api/display/route.ts's own
// comment: no skill level, no phone/email, no payment/verification
// state, no full names), so the tradeoff is real but bounded: this
// path is discoverable/guessable by design, the slug-based one stays
// available for anyone who still wants an unadvertised URL. Both serve
// the identical live data — this isn't a second, separate display.
export default async function TvShortcutPage() {
  const [initialData, announcementRepeatCount, timeUpFlashDurationSeconds, announcementVoice, refreshIntervalSeconds, gameWarning] =
    await Promise.all([
      displayService.getDisplayData(),
      settingsService.getAnnouncementRepeatCount(),
      settingsService.getTimeUpFlashDurationSeconds(),
      settingsService.getAnnouncementVoice(),
      settingsService.getDisplayRefreshIntervalSeconds(),
      settingsService.getGameWarningSettings(),
    ]);

  return (
    <TvDisplayClient
      initialData={initialData}
      announcementRepeatCount={announcementRepeatCount}
      timeUpFlashDurationSeconds={timeUpFlashDurationSeconds}
      announcementVoice={announcementVoice}
      refreshIntervalSeconds={refreshIntervalSeconds}
      gameWarningEnabled={gameWarning.enabled}
      gameWarningMinutes={gameWarning.minutes}
    />
  );
}
