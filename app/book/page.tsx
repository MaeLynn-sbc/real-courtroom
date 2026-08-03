import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PublicBookingForm } from "@/features/bookings/components/public-booking-form";
import { bookingService } from "@/services/booking/booking.service";
import { courtService } from "@/services/court/court.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Book a Court",
  description: "Book a pickleball court at The Courtroom.",
};

export const dynamic = "force-dynamic";

interface BookPageProps {
  searchParams: Promise<{
    courtId?: string;
    date?: string;
    time?: string;
    durationMinutes?: string;
  }>;
}

// Arriving here with courtId+date+time means a click straight through
// from the availability grid — that grid's data is a snapshot from
// whenever its page loaded, so the slot can have been taken in the
// meantime. "T${time}:00" (not a bare "YYYY-MM-DD") parses as LOCAL
// time, same idiom used everywhere else in this codebase after the
// Reports date-range bug (services/analytics/date-range.ts) — a plain
// date-only string would parse as UTC regardless of process timezone.
function resolveDeepLinkedSlot(
  date: string | undefined,
  time: string | undefined,
  durationMinutes: string | undefined,
): { startAt: Date; endAt: Date } | null {
  if (!date || !time) {
    return null;
  }
  const startAt = new Date(`${date}T${time}:00`);
  if (Number.isNaN(startAt.getTime())) {
    return null;
  }
  const minutes = Number(durationMinutes) || 60;
  return { startAt, endAt: new Date(startAt.getTime() + minutes * 60_000) };
}

export default async function BookPage({ searchParams }: BookPageProps) {
  const { courtId, date, time, durationMinutes } = await searchParams;
  const deepLinkedSlot = courtId ? resolveDeepLinkedSlot(date, time, durationMinutes) : null;

  const [
    courts,
    requiresPrepayment,
    courtHours,
    gcashInfo,
    businessInfo,
    bookingCommunication,
    slotAvailability,
  ] = await Promise.all([
    courtService.listCourts(),
    settingsService.getBookingRequirePrepayment(),
    settingsService.getCourtHours(),
    settingsService.getGcashPaymentInfo(),
    settingsService.getBusinessInfo(),
    settingsService.getBookingCommunicationSettings(),
    // Read-only, non-transactional preview (bookingService.checkAvailability)
    // — same one this same form's own live pre-submit check already
    // uses. The real gate stays createPublicBooking's own Serializable-
    // transaction check at actual submission; this is only about not
    // showing a pre-filled form for a slot that's visibly already gone,
    // rather than letting the customer fill in name/phone/payment
    // first and find out at the very end.
    deepLinkedSlot
      ? bookingService.checkAvailability(courtId!, deepLinkedSlot.startAt, deepLinkedSlot.endAt)
      : Promise.resolve(null),
  ]);
  const courtOptions = courts
    .filter((court) => court.status === "ACTIVE")
    .map((court) => ({ id: court.id, name: court.name, hourlyRateCents: court.hourlyRateCents }));

  if (deepLinkedSlot && slotAvailability && !slotAvailability.available) {
    return (
      <div className="flex min-h-svh flex-1 flex-col">
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center gap-4 px-6 py-24 text-center">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            That slot was just taken
          </h1>
          <p className="text-muted-foreground text-lg">
            Someone booked this court and time while you were looking at the schedule. Pick another
            slot below.
          </p>
          <Link href="/availability" className={buttonVariants({ size: "lg" })}>
            Back to availability
          </Link>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
        <PublicBookingForm
          courts={courtOptions}
          courtHours={courtHours}
          gcashInfo={gcashInfo}
          contactPhone={businessInfo.phone}
          contactFacebookUrl={businessInfo.facebookUrl}
          initialCourtId={courtId}
          initialDate={date}
          initialTime={time}
          initialDurationMinutes={durationMinutes}
          requiresPrepayment={requiresPrepayment}
          pageConfirmationCopy={bookingCommunication.pageConfirmationCopy}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
