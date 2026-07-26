import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PublicOpenPlayRegistrationForm } from "@/features/open-play-capacity/components/public-open-play-registration-form";
import { openPlayCapacityService } from "@/services/open-play/open-play-capacity.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Register for Open Play",
  description: "Register online for an upcoming Open Play night at The Courtroom.",
};

export const dynamic = "force-dynamic";

const UPCOMING_NIGHTS_COUNT = 21; // 3 weeks — plenty of runway past any reasonable lead-time setting.
const labelFormatter = new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric" });

function toLocalDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default async function OpenPlayRegisterPage() {
  const featureEnabled = await settingsService.getOpenPlayOnlineRegistrationEnabled();

  if (!featureEnabled) {
    return (
      <div className="flex min-h-svh flex-1 flex-col">
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Register for Open Play</h1>
          <p className="text-muted-foreground">
            Online registration isn&apos;t available right now — please visit the front desk.
          </p>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const [upcomingNights, capacityDefaults, openPlaySettings] = await Promise.all([
    openPlayCapacityService.getUpcomingNights(UPCOMING_NIGHTS_COUNT),
    openPlayCapacityService.getCapacityDefaults(),
    settingsService.getOpenPlaySettings(),
  ]);

  // Filtered by the per-day toggle only — NOT by the lead-time window.
  // Duplicating that day-count math here would risk drifting from
  // createPublicOpenPlayRegistration's own computation; the action
  // already returns a clear "opens on <date>" message (rendered by the
  // form) if someone picks a night too far out, so this page doesn't
  // need a second copy of that logic to stay correct.
  const eligibleNights = upcomingNights
    .filter((night) => capacityDefaults.find((row) => row.dayOfWeek === night.dayOfWeek)?.onlineRegistrationEnabled ?? false)
    .map((night) => ({ date: toLocalDateValue(night.date), label: labelFormatter.format(night.date) }));

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
        <div>
          <h1 className="font-heading text-4xl font-semibold tracking-tight">Register for Open Play</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Reserve your spot for an upcoming Friday or Saturday night.
          </p>
        </div>

        {eligibleNights.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No nights are open for online registration right now. Please check back later or visit the
            front desk.
          </p>
        ) : (
          <PublicOpenPlayRegistrationForm
            nights={eligibleNights}
            registrationFeeCents={openPlaySettings.friSatRegistrationFeeCents}
          />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
