import type { Metadata } from "next";
import Link from "next/link";

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

interface OpenPlayRegisterPageProps {
  searchParams: Promise<{ date?: string }>;
}

export default async function OpenPlayRegisterPage({ searchParams }: OpenPlayRegisterPageProps) {
  const { date: requestedDate } = await searchParams;
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

  const [upcomingNights, capacityDefaults, openPlaySettings, gcashInfo, businessInfo] = await Promise.all([
    openPlayCapacityService.getUpcomingNights(UPCOMING_NIGHTS_COUNT),
    openPlayCapacityService.getCapacityDefaults(),
    settingsService.getOpenPlaySettings(),
    // Reported live: this page never fetched or passed the venue's GCash
    // QR/account details at all — the payment screen asked for a
    // reference and screenshot with no way to know where to actually
    // send the money. Same source of truth the court booking flow
    // already uses (app/book/page.tsx), not a second copy.
    settingsService.getGcashPaymentInfo(),
    settingsService.getBusinessInfo(),
  ]);

  // Filtered by the per-day toggle and the per-date block — NOT by the
  // lead-time window. Duplicating that day-count math here would risk
  // drifting from createPublicOpenPlayRegistration's own computation;
  // the action already returns a clear "opens on <date>" message
  // (rendered by the form) if someone picks a night too far out, so
  // this page doesn't need a second copy of that logic to stay
  // correct.
  const dayEnabledNights = upcomingNights.filter(
    (night) => capacityDefaults.find((row) => row.dayOfWeek === night.dayOfWeek)?.onlineRegistrationEnabled ?? false,
  );
  const blockedNights = dayEnabledNights.filter((night) => night.onlineRegistrationBlocked);
  const eligibleNights = dayEnabledNights
    .filter((night) => !night.onlineRegistrationBlocked)
    .map((night) => ({ date: toLocalDateValue(night.date), label: labelFormatter.format(night.date) }));

  // QR/deep-link mode (?date=YYYY-MM-DD) — locks the form to exactly this
  // date, no picker. Reuses the exact same eligibility computation as the
  // normal picker above (day-of-week toggle, per-date block, the 21-day
  // upcoming window) rather than re-deriving it, so a date this page
  // would reject here is never one the normal picker would have offered
  // either — one source of truth, not two that could drift apart. A
  // malformed date, a past date, a non-Fri/Sat date, or one too far out
  // just never appears in eligibleNights/blockedNights, so all of those
  // land on the same clear "not open" message below instead of a 500 or
  // a confusing blank state.
  if (requestedDate) {
    const lockedNight = eligibleNights.find((night) => night.date === requestedDate);

    if (!lockedNight) {
      const isBlockedDate = blockedNights.some((night) => toLocalDateValue(night.date) === requestedDate);
      return (
        <div className="flex min-h-svh flex-1 flex-col">
          <SiteHeader />
          <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">Register for Open Play</h1>
            <p className="text-muted-foreground">
              {isBlockedDate
                ? "Online registration is closed for that date — contact us directly."
                : "That date isn't open for online registration right now."}
            </p>
            <Link href="/open-play/register" className="text-primary text-sm font-medium hover:underline">
              See all upcoming nights
            </Link>
          </main>
          <SiteFooter />
        </div>
      );
    }

    return (
      <div className="flex min-h-svh flex-1 flex-col">
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
          <div>
            <h1 className="font-heading text-4xl font-semibold tracking-tight">Register for Open Play</h1>
            <p className="text-muted-foreground mt-2 text-lg">Reserve your spot for {lockedNight.label}.</p>
          </div>
          <PublicOpenPlayRegistrationForm
            nights={[lockedNight]}
            registrationFeeCents={openPlaySettings.friSatRegistrationFeeCents}
            lockedDate={lockedNight}
            gcashInfo={gcashInfo}
            contactPhone={businessInfo.phone}
            contactFacebookUrl={businessInfo.facebookUrl}
          />
        </main>
        <SiteFooter />
      </div>
    );
  }

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

        {blockedNights.length > 0 ? (
          <p className="border-warning/40 bg-warning/10 rounded-lg border px-3 py-2 text-sm">
            Online registration is closed for{" "}
            {blockedNights.map((night) => labelFormatter.format(night.date)).join(", ")} — contact us
            directly for {blockedNights.length === 1 ? "that date" : "those dates"}.
          </p>
        ) : null}

        {eligibleNights.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No nights are open for online registration right now. Please check back later or visit the
            front desk.
          </p>
        ) : (
          <PublicOpenPlayRegistrationForm
            nights={eligibleNights}
            registrationFeeCents={openPlaySettings.friSatRegistrationFeeCents}
            gcashInfo={gcashInfo}
            contactPhone={businessInfo.phone}
            contactFacebookUrl={businessInfo.facebookUrl}
          />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
