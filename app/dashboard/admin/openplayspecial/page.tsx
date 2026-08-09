import type { Metadata } from "next";

import { TvDisplayClient } from "@/features/display/components/tv-display-client";
import { displayService } from "@/services/display/display.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Court Status — Private",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Owner request (2026-08-09): "copy exact codes for the open play. only
// visible to me in the dashboard." Byte-identical to app/tv/page.tsx —
// same TvDisplayClient, same displayService.getDisplayData() call, same
// live poll/speech-queue/token-diff behavior — the only difference is
// where it lives: under /dashboard/admin, so middleware.ts's
// /dashboard/:path* auth gate applies (unlike /tv, which is
// deliberately public/unguessable-free) and lib/rbac.ts's
// /dashboard/admin default (SYSTEM_ADMIN, Owner/Manager tier) restricts
// it further — no new rbac.ts entry needed, it just inherits that
// parent rule like every other unlisted /dashboard/admin/* page.
export default async function OpenPlaySpecialPage() {
  const [
    initialData,
    announcementRepeatCount,
    timeUpFlashDurationSeconds,
    announcementVoice,
    refreshIntervalSeconds,
    gameWarning,
    timesUpTemplate,
  ] = await Promise.all([
    displayService.getDisplayData(),
    settingsService.getAnnouncementRepeatCount(),
    settingsService.getTimeUpFlashDurationSeconds(),
    settingsService.getAnnouncementVoice(),
    settingsService.getDisplayRefreshIntervalSeconds(),
    settingsService.getGameWarningSettings(),
    settingsService.getTimesUpTemplate(),
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
      timesUpTemplate={timesUpTemplate}
    />
  );
}
