import type { Metadata } from "next";

import { TvDisplayClient } from "@/features/display/components/tv-display-client";
import { displayService } from "@/services/display/display.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "The Line — Open Play",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Owner request (2026-09-17): the physical paddle box was being
// double-stacked. This screen replaces it: /tv exactly — court cards,
// game timers, time's-up flash, voice announcements — with the lower
// panel showing the queue as numbered sets of four (line-panel.tsx).
// Same data and settings as /tv; only `variant` differs.
export default async function RotationLineTvPage() {
  const [
    initialData,
    announcementRepeatCount,
    timeUpFlashDurationSeconds,
    announcementVoice,
    refreshIntervalSeconds,
    gameWarning,
    timesUpTemplate,
  ] = await Promise.all([
    settingsService.getPracticeTakeoverRtv().then((practice) => displayService.getDisplayData({ practice })),
    settingsService.getAnnouncementRepeatCount(),
    settingsService.getTimeUpFlashDurationSeconds(),
    settingsService.getAnnouncementVoice(),
    settingsService.getDisplayRefreshIntervalSeconds(),
    settingsService.getGameWarningSettings(),
    settingsService.getTimesUpTemplate(),
  ]);

  return (
    <TvDisplayClient
      variant="line"
      initialData={initialData}
      announcementRepeatCount={announcementRepeatCount}
      timeUpFlashDurationSeconds={timeUpFlashDurationSeconds}
      announcementVoice={announcementVoice}
      refreshIntervalSeconds={refreshIntervalSeconds}
      gameWarningEnabled={gameWarning.enabled}
      gameWarningMinutes={gameWarning.minutes}
      timesUpTemplate={timesUpTemplate}
    />
  );
}
