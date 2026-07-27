import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
const todayLabelFormatter = new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric" });

export default async function OpenPlayCapacityPage() {
  const [defaults, upcomingNights, openPlaySettings] = await Promise.all([
    openPlayCapacityService.getCapacityDefaults(),
    openPlayCapacityService.getUpcomingNights(UPCOMING_NIGHTS_COUNT),
    settingsService.getOpenPlaySettings(),
  ]);
  const today = new Date();
  const todayValue = dateValueFormatter(today);
  // The underlying page this links to (app/dashboard/admin/open-play-
  // capacity/[date]/page.tsx) already derives its own mode from this
  // exact same day-of-week check — unchanged, not duplicated logic,
  // just read here too so the nav can match what staff will actually
  // land on instead of showing a "weeknight" link on a Fri/Sat night.
  const isTodayCapacityNight = [5, 6].includes(today.getDay());

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
        <h1 className="text-2xl font-semibold tracking-tight">Open Play</h1>
        <p className="text-muted-foreground text-sm">
          Two separate modes: Fri/Sat capacity nights (scheduled, prepaid, capacity-limited) and
          weeknight drop-in (uncapped, today only) — check in below under whichever one applies tonight.
        </p>
      </div>

      {/* Presentation-only separation from here down — no change to
          isCapacityNight, the branching, or any service code. Staff
          were finding this page's own "Tonight's check-in" link
          ambiguous about which mode it led to; each mode now has its
          own clearly labeled entry point instead. */}
      <Card>
        <CardHeader>
          <CardTitle>Weeknight Drop-In</CardTitle>
        </CardHeader>
        <CardContent>
          {isTodayCapacityNight ? (
            <p className="text-muted-foreground text-sm">
              Tonight ({todayLabelFormatter.format(today)}) is a Fri/Sat capacity night — see &quot;Fri/Sat Capacity
              Nights&quot; below.
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{todayLabelFormatter.format(today)}</p>
                <p className="text-muted-foreground text-sm">No capacity, no prepayment — most players just walk in.</p>
              </div>
              <Link href={`/dashboard/admin/open-play-capacity/${todayValue}`} className={buttonVariants({ size: "sm" })}>
                Open tonight&apos;s check-in
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Fri/Sat Capacity Nights</h2>
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
