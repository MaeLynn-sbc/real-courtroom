import type { Metadata } from "next";

import { RotationLineTvClient } from "@/features/display/components/rotation-line-tv-client";
import { displayService } from "@/services/display/display.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "The Line — Open Play",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Owner request (2026-09-17): the physical paddle box was being
// double-stacked. This screen replaces it — the queue as numbered sets
// of four, first come first served, on a TV by the courts. Same data
// and privacy rules as /tv (first names only, nothing else), server-
// rendered first frame then polled, same as every other display route.
export default async function RotationLineTvPage() {
  const [initialData, refreshIntervalSeconds] = await Promise.all([
    displayService.getDisplayData({ nameFormat: "first" }),
    settingsService.getDisplayRefreshIntervalSeconds(),
  ]);

  return <RotationLineTvClient initialData={initialData} refreshIntervalSeconds={refreshIntervalSeconds} />;
}
