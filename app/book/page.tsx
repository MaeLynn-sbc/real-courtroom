import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PublicBookingForm } from "@/features/bookings/components/public-booking-form";
import { courtService } from "@/services/court/court.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Book a Court",
  description: "Book a pickleball court at The Courtroom.",
};

export const dynamic = "force-dynamic";

interface BookPageProps {
  searchParams: Promise<{ courtId?: string; date?: string; time?: string; durationMinutes?: string }>;
}

export default async function BookPage({ searchParams }: BookPageProps) {
  const [
    courts,
    { courtId, date, time, durationMinutes },
    requiresPrepayment,
    holdMinutes,
    courtHours,
    gcashInfo,
    businessInfo,
  ] = await Promise.all([
    courtService.listCourts(),
    searchParams,
    settingsService.getBookingRequirePrepayment(),
    settingsService.getBookingHoldMinutes(),
    settingsService.getCourtHours(),
    settingsService.getGcashPaymentInfo(),
    settingsService.getBusinessInfo(),
  ]);
  const courtOptions = courts
    .filter((court) => court.status === "ACTIVE")
    .map((court) => ({ id: court.id, name: court.name, hourlyRateCents: court.hourlyRateCents }));

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
        <div className="text-center">
          <h1 className="font-heading text-4xl font-semibold tracking-tight">Book Now</h1>
          {/* Phase 8: "pay when you arrive" is only ever true for a
              pay-at-venue booking — the public/online default once the
              prepayment switch is on, and always the case while it's
              off. Never state it unconditionally: once the switch
              flips on, pay-at-venue becomes a staff-assisted-only
              capability (BOOKINGS_PAY_AT_VENUE), not something this
              public form still offers by default. */}
          <p className="text-muted-foreground mt-2 text-lg">
            {requiresPrepayment
              ? "Reserve your court in a minute — pay via GCash to confirm your slot."
              : "Reserve your court — quick and easy."}
          </p>
        </div>
        <PublicBookingForm
          courts={courtOptions}
          courtHours={courtHours}
          gcashInfo={gcashInfo}
          contactPhone={businessInfo.phone}
          contactFacebookUrl={businessInfo.facebookUrl}
          holdMinutes={holdMinutes}
          initialCourtId={courtId}
          initialDate={date}
          initialTime={time}
          initialDurationMinutes={durationMinutes}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
