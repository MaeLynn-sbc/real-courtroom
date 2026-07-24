import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { CheckInPanel } from "@/features/open-play-capacity/components/checkin-panel";
import { RegistrationRosterPanel } from "@/features/open-play-capacity/components/registration-roster-panel";
import { WalkInRegistrationForm, type RegistrablePlayer } from "@/features/open-play-capacity/components/walk-in-registration-form";
import { openPlayCapacityService } from "@/services/open-play/open-play-capacity.service";
import { openPlayCheckinService } from "@/services/open-play/open-play-checkin.service";
import { openPlayRegistrationService } from "@/services/open-play/open-play-registration.service";
import { playerService } from "@/services/player/player.service";

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

function toRegistrablePlayers(
  players: Awaited<ReturnType<typeof playerService.listPlayers>>,
): RegistrablePlayer[] {
  return players
    .filter((player) => player.phone)
    .map((player) => ({
      id: player.id,
      name: player.user.name ?? player.user.email ?? "Unnamed player",
      phone: player.phone ?? "",
      openPlaySkillLevel: player.openPlaySkillLevel,
    }));
}

export default async function OpenPlayNightPage({ params }: OpenPlayNightPageProps) {
  const { date: dateParam } = await params;
  const date = new Date(`${dateParam}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    notFound();
  }

  const isCapacityNight = [5, 6].includes(date.getDay());
  const players = toRegistrablePlayers(await playerService.listPlayers());

  if (isCapacityNight) {
    // Viewing the page materializes the session (if it doesn't already
    // exist) the same way an owner setting a per-date override does —
    // "one per date, created on demand" (BUILD-SPEC.md §5).
    const session = await openPlayCapacityService.getOrCreateSessionForDate(date);
    const [{ registrations, skillBreakdown }, { expected, checkedIn }] = await Promise.all([
      openPlayRegistrationService.getSessionRegistrations(session.id),
      openPlayCheckinService.getCheckInScreenData({ sessionId: session.id }),
    ]);

    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div>
          <Link href="/dashboard/admin/open-play-capacity" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            ‹ Open Play Capacity
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{labelFormatter.format(session.date)}</h1>
          <p className="text-muted-foreground text-sm">Capacity {session.capacity}.</p>
        </div>

        <WalkInRegistrationForm target={{ sessionId: session.id }} players={players} />
        <CheckInPanel
          expected={serializeRegistrations(expected)}
          checkedIn={serializeRegistrations(checkedIn)}
        />
        <RegistrationRosterPanel registrations={registrations} skillBreakdown={skillBreakdown} capacity={session.capacity} />
      </div>
    );
  }

  // Weeknight — BUILD-SPEC.md §0 "no session records, no capacity, no
  // waitlist." Registration is optional and uncapped; most players just
  // walk in.
  const { expected, checkedIn } = await openPlayCheckinService.getCheckInScreenData({ date });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link href="/dashboard/admin/open-play-capacity" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ‹ Open Play Capacity
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{labelFormatter.format(date)}</h1>
        <p className="text-muted-foreground text-sm">Weeknight drop-in — no capacity, no prepayment.</p>
      </div>

      <WalkInRegistrationForm target={{ date: dateParam }} players={players} showRegisterOnly={false} />
      <CheckInPanel expected={serializeRegistrations(expected)} checkedIn={serializeRegistrations(checkedIn)} />
    </div>
  );
}

function serializeRegistrations<T extends { checkedInAt: Date | null }>(
  registrations: T[],
): (Omit<T, "checkedInAt"> & { checkedInAt: string | null })[] {
  return registrations.map((registration) => ({
    ...registration,
    checkedInAt: registration.checkedInAt ? registration.checkedInAt.toISOString() : null,
  }));
}
