import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { RegistrationRosterPanel } from "@/features/open-play-capacity/components/registration-roster-panel";
import { WalkInRegistrationForm } from "@/features/open-play-capacity/components/walk-in-registration-form";
import { openPlayCapacityService } from "@/services/open-play/open-play-capacity.service";
import { openPlayRegistrationService } from "@/services/open-play/open-play-registration.service";

export const metadata: Metadata = {
  title: "Open Play Night",
};

export const dynamic = "force-dynamic";

const labelFormatter = new Intl.DateTimeFormat("en-PH", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

interface OpenPlayNightPageProps {
  params: Promise<{ date: string }>;
}

export default async function OpenPlayNightPage({ params }: OpenPlayNightPageProps) {
  const { date: dateParam } = await params;
  const date = new Date(`${dateParam}T00:00:00`);
  if (Number.isNaN(date.getTime()) || ![5, 6].includes(date.getDay())) {
    notFound();
  }

  // Viewing the roster materializes the session (if it doesn't already
  // exist) the same way an owner setting a per-date override does —
  // "one per date, created on demand" (BUILD-SPEC.md §5).
  const session = await openPlayCapacityService.getOrCreateSessionForDate(date);
  const { registrations, skillBreakdown } = await openPlayRegistrationService.getSessionRegistrations(session.id);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link href="/dashboard/admin/open-play-capacity" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ‹ Open Play Capacity
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{labelFormatter.format(session.date)}</h1>
        <p className="text-muted-foreground text-sm">Capacity {session.capacity}.</p>
      </div>

      <WalkInRegistrationForm sessionId={session.id} />
      <RegistrationRosterPanel registrations={registrations} skillBreakdown={skillBreakdown} capacity={session.capacity} />
    </div>
  );
}
