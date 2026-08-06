import type { Metadata } from "next";

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

  // Real incident (2026-08-06): this used to short-circuit the whole
  // page with a hard "That slot was just taken" block right here, before
  // PublicBookingForm ever mounted — which had no way to tell "someone
  // else took it" from "this is MY OWN hold, and a reload (e.g.
  // switching to the GCash app and back) just wiped my confirmation
  // screen." That decision now lives in PublicBookingForm itself, which
  // can check localStorage for its own just-created hold before
  // committing to the same message — see its own
  // deepLinkedSlotUnavailable prop comment and reload-recovery effect.
  const deepLinkedSlotUnavailable = Boolean(
    deepLinkedSlot && slotAvailability && !slotAvailability.available,
  );

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
          deepLinkedSlotUnavailable={deepLinkedSlotUnavailable}
          requiresPrepayment={requiresPrepayment}
          pageConfirmationCopy={bookingCommunication.pageConfirmationCopy}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
