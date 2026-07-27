import type { Metadata } from "next";

import { CapacityDefaultsPanel } from "@/features/open-play-capacity/components/capacity-defaults-panel";
import { OpenPlaySettingsPanel } from "@/features/open-play-capacity/components/open-play-settings-panel";
import { UpcomingNightsPanel } from "@/features/open-play-capacity/components/upcoming-nights-panel";
import { openPlayCapacityService } from "@/services/open-play/open-play-capacity.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Fri/Sat Open Play",
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

  const fridayCapacity = defaults.find((row) => row.dayOfWeek === 5)?.capacity ?? 0;
  const saturdayCapacity = defaults.find((row) => row.dayOfWeek === 6)?.capacity ?? 0;
  const fridayOnlineRegistrationEnabled = defaults.find((row) => row.dayOfWeek === 5)?.onlineRegistrationEnabled ?? true;
  const saturdayOnlineRegistrationEnabled = defaults.find((row) => row.dayOfWeek === 6)?.onlineRegistrationEnabled ?? true;

  const nights = upcomingNights.map((night) => ({
    date: dateValueFormatter(night.date),
    label: labelFormatter.format(night.date),
    capacity: night.capacity,
    isOverride: night.isOverride,
    status: night.status,
    registeredCount: night.registeredCount,
    waitlistedCount: night.waitlistedCount,
  }));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fri/Sat Open Play</h1>
        <p className="text-muted-foreground text-sm">
          Scheduled, prepaid, capacity-limited capacity nights. Looking for tonight&apos;s weeknight
          drop-in check-in instead? Use &quot;Weeknight Open Play&quot; in the sidebar.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <CapacityDefaultsPanel
          fridayCapacity={fridayCapacity}
          saturdayCapacity={saturdayCapacity}
          fridayOnlineRegistrationEnabled={fridayOnlineRegistrationEnabled}
          saturdayOnlineRegistrationEnabled={saturdayOnlineRegistrationEnabled}
        />
        <OpenPlaySettingsPanel {...openPlaySettings} />
        <UpcomingNightsPanel nights={nights} />
      </div>
    </div>
  );
}
