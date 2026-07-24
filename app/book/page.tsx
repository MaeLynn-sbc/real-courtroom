import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PublicBookingForm } from "@/features/bookings/components/public-booking-form";
import { courtService } from "@/services/court/court.service";

export const metadata: Metadata = {
  title: "Book a Court",
  description: "Book a pickleball court at The Courtroom.",
};

export const dynamic = "force-dynamic";

interface BookPageProps {
  searchParams: Promise<{ courtId?: string; date?: string; time?: string; durationMinutes?: string }>;
}

export default async function BookPage({ searchParams }: BookPageProps) {
  const [courts, { courtId, date, time, durationMinutes }] = await Promise.all([
    courtService.listCourts(),
    searchParams,
  ]);
  const courtOptions = courts
    .filter((court) => court.status === "ACTIVE")
    .map((court) => ({ id: court.id, name: court.name }));

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
        <div className="text-center">
          <h1 className="font-heading text-4xl font-semibold tracking-tight">Book Now</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Reserve your court in a minute — pay when you arrive.
          </p>
        </div>
        <PublicBookingForm
          courts={courtOptions}
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
