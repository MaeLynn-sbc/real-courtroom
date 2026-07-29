import type { Metadata } from "next";

import { BookingForm } from "@/features/bookings/components/booking-form";
import { courtService } from "@/services/court/court.service";
import { playerService } from "@/services/player/player.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "New Booking",
};

// Verified bug (pre-existing since Phase 4, found live during v1.1
// Sub-phase 1 prod-mode testing): no searchParams/dynamic segment/auth()
// call here to signal Next this page needs live rendering, so it was
// statically prerendered at build time and never showed a court created
// after the build. See ARCHITECTURE.md's v1.1 addendum.
export const dynamic = "force-dynamic";

export default async function NewBookingPage() {
  const [courts, players, courtHours, openPlaySettings] = await Promise.all([
    courtService.listCourts(),
    playerService.listPlayers(),
    settingsService.getCourtHours(),
    settingsService.getOpenPlaySettings(),
  ]);

  const activeCourts = courts
    .filter((court) => court.status !== "DISABLED")
    .map((court) => ({ id: court.id, name: court.name, hourlyRateCents: court.hourlyRateCents }));

  const playerOptions = players.map((player) => ({
    id: player.id,
    label: player.user.name ?? player.user.email ?? "Unknown player",
  }));

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New booking</h1>
        <p className="text-muted-foreground text-sm">
          Book a court for a walk-in or a specific future time.
        </p>
      </div>
      <BookingForm
        courts={activeCourts}
        players={playerOptions}
        courtHours={courtHours}
        shortSessionPriceCents={openPlaySettings.shortSessionPriceCents}
      />
    </div>
  );
}
