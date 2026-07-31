import type { Metadata } from "next";

import { auth } from "@/auth";
import { TvDisplaySetupPanel } from "@/features/display/components/tv-display-setup-panel";
import { env } from "@/lib/env";
import { hasPermission } from "@/lib/rbac";
import { generateDisplayQrCode, generateOpenPlayRegistrationQrCode } from "@/services/display/qr-code";
import { settingsService } from "@/services/settings/settings.service";
import { PERMISSIONS } from "@/types/permissions";

export const metadata: Metadata = {
  title: "TV Display",
};

// BUILD-SPEC.md §13: "Staff can view, owner can edit." No permission
// gate on the page itself — middleware.ts already requires a signed-in
// staff session for everything under /dashboard. Two DIFFERENT edit
// gates below, not one: DISPLAY_MANAGE (operational settings — reported
// live, the attendant at the display needs these, not just the owner)
// vs SYSTEM_ADMIN (regenerating the URL — the display's own auth token,
// deliberately still narrower).
export const dynamic = "force-dynamic";

export default async function TvDisplaySetupPage() {
  const [session, slug, announcementRepeatCount, timeUpFlashDurationSeconds, announcementVoice, refreshIntervalSeconds, gameWarning] =
    await Promise.all([
      auth(),
      settingsService.getOrCreateDisplaySlug(),
      settingsService.getAnnouncementRepeatCount(),
      settingsService.getTimeUpFlashDurationSeconds(),
      settingsService.getAnnouncementVoice(),
      settingsService.getDisplayRefreshIntervalSeconds(),
      settingsService.getGameWarningSettings(),
    ]);
  const canRegenerate = hasPermission(session?.user.permissions ?? [], PERMISSIONS.SYSTEM_ADMIN);
  const canManageDisplaySettings = hasPermission(session?.user.permissions ?? [], PERMISSIONS.DISPLAY_MANAGE);

  const [displayQrDataUrl, openPlayQrDataUrl] = await Promise.all([
    generateDisplayQrCode(slug),
    generateOpenPlayRegistrationQrCode(),
  ]);

  const baseUrl = env.AUTH_URL ?? "http://localhost:3000";
  const displayUrl = new URL(`/display/${slug}`, baseUrl).toString();
  const shortDisplayUrl = new URL("/tv", baseUrl).toString();
  const openPlayRegistrationUrl = new URL("/open-play/register", baseUrl).toString();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">TV Display</h1>
        <p className="text-muted-foreground text-sm">
          The URL and QR code for the lobby TV, plus a live preview so you can confirm it works without walking
          out to check.
        </p>
      </div>

      <TvDisplaySetupPanel
        displayUrl={displayUrl}
        shortDisplayUrl={shortDisplayUrl}
        displayQrDataUrl={displayQrDataUrl}
        openPlayRegistrationUrl={openPlayRegistrationUrl}
        openPlayQrDataUrl={openPlayQrDataUrl}
        canRegenerate={canRegenerate}
        canManageDisplaySettings={canManageDisplaySettings}
        announcementRepeatCount={announcementRepeatCount}
        timeUpFlashDurationSeconds={timeUpFlashDurationSeconds}
        announcementVoice={announcementVoice}
        refreshIntervalSeconds={refreshIntervalSeconds}
        gameWarningEnabled={gameWarning.enabled}
        gameWarningMinutes={gameWarning.minutes}
      />
    </div>
  );
}
