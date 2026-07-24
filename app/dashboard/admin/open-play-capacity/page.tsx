import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { CapacityDefaultsPanel } from "@/features/open-play-capacity/components/capacity-defaults-panel";
import { OpenPlaySettingsPanel } from "@/features/open-play-capacity/components/open-play-settings-panel";
import { UpcomingNightsPanel } from "@/features/open-play-capacity/components/upcoming-nights-panel";
import { openPlayCapacityService } from "@/services/open-play/open-play-capacity.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Open Play Capacity",
};

// Same reason as every other admin settings page in this app (see
// app/dashboard/admin/settings/page.tsx) — without this, a saved override
// wouldn't show up until the next full rebuild.
export const dynamic = "force-dynamic";

const UPCOMING_NIGHTS_COUNT = 8;

const dateValueFormatter = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const labelFormatter = new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric" });

export default async function OpenPlayCapacityPage() {
  const [defaults, upcomingNights, openPlaySettings] = await Promise.all([
    openPlayCapacityService.getCapacityDefaults(),
    openPlayCapacityService.getUpcomingNights(UPCOMING_NIGHTS_COUNT),
    settingsService.getOpenPlaySettings(),
  ]);
  const todayValue = dateValueFormatter(new Date());

  const fridayCapacity = defaults.find((row) => row.dayOfWeek === 5)?.capacity ?? 0;
  const saturdayCapacity = defaults.find((row) => row.dayOfWeek === 6)?.capacity ?? 0;

  const nights = upcomingNights.map((night) => ({
    date: dateValueFormatter(night.date),
    label: labelFormatter.format(night.date),
    capacity: night.capacity,
    isOverride: night.isOverride,
    status: night.status,
  }));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Open Play Capacity</h1>
          <p className="text-muted-foreground text-sm">
            Friday/Saturday open play capacity — weekday defaults and per-date overrides.
          </p>
        </div>
        <Link href={`/dashboard/admin/open-play-capacity/${todayValue}`} className={buttonVariants({ size: "sm" })}>
          Tonight&apos;s check-in
        </Link>
      </div>

      <CapacityDefaultsPanel fridayCapacity={fridayCapacity} saturdayCapacity={saturdayCapacity} />
      <OpenPlaySettingsPanel noShowReleaseMinutes={openPlaySettings.noShowReleaseMinutes} />
      <UpcomingNightsPanel nights={nights} />
    </div>
  );
}
