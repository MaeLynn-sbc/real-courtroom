import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { CheckInPanel } from "@/features/open-play-capacity/components/checkin-panel";
import { CloseSessionButton } from "@/features/open-play-capacity/components/close-session-button";
import { RegistrationRosterPanel } from "@/features/open-play-capacity/components/registration-roster-panel";
import { RotationBoard } from "@/features/open-play-capacity/components/rotation-board";
import { TabsPanel } from "@/features/open-play-capacity/components/tabs-panel";
import { WalkInRegistrationForm, type RegistrablePlayer } from "@/features/open-play-capacity/components/walk-in-registration-form";
import type { PlayerTab } from "@/lib/generated/prisma/client";
import type { GameAssignmentWithParticipants, RotationBoardData } from "@/services/open-play/open-play-rotation.service";
import { openPlayCapacityService } from "@/services/open-play/open-play-capacity.service";
import { openPlayCheckinService } from "@/services/open-play/open-play-checkin.service";
import { openPlayRegistrationService } from "@/services/open-play/open-play-registration.service";
import { openPlayRotationService } from "@/services/open-play/open-play-rotation.service";
import { playerTabService } from "@/services/open-play/player-tab.service";
import { playerService } from "@/services/player/player.service";
import { saleService } from "@/services/sales/sale.service";

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
    const [{ registrations, skillBreakdown }, { expected, checkedIn }, board, tabs, paymentMethods] = await Promise.all([
      openPlayRegistrationService.getSessionRegistrations(session.id),
      openPlayCheckinService.getCheckInScreenData({ sessionId: session.id }),
      openPlayRotationService.getRotationBoardData(date),
      playerTabService.listTabsForDate(date),
      saleService.listPaymentMethods(),
    ]);
    const hasUnsettledTabs = tabs.some((t) => t.status === "OPEN" && t.totalCents > 0);

    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/dashboard/admin/open-play-capacity" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              ‹ Open Play Capacity
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{labelFormatter.format(session.date)}</h1>
            <p className="text-muted-foreground text-sm">
              Capacity {session.capacity}. Status: {session.status}.
            </p>
          </div>
          {session.status === "OPEN" ? (
            <CloseSessionButton sessionId={session.id} disabled={hasUnsettledTabs} />
          ) : null}
        </div>

        <WalkInRegistrationForm
          target={{ sessionId: session.id }}
          players={players}
          paymentMethods={paymentMethods.map((pm) => ({ id: pm.id, label: pm.label }))}
        />
        <CheckInPanel
          expected={serializeRegistrations(expected)}
          checkedIn={serializeRegistrations(checkedIn)}
        />
        <RegistrationRosterPanel registrations={registrations} skillBreakdown={skillBreakdown} capacity={session.capacity} />
        <RotationBoard {...serializeBoard(dateParam, board)} />
        <TabsPanel tabs={serializeTabs(tabs)} paymentMethods={paymentMethods.map((pm) => ({ id: pm.id, label: pm.label }))} />
      </div>
    );
  }

  // Weeknight — BUILD-SPEC.md §0: no capacity, no waitlist, no
  // prepayment. Registration is optional and uncapped; most players just
  // walk in.
  const [{ expected, checkedIn }, board, tabs, paymentMethods] = await Promise.all([
    openPlayCheckinService.getCheckInScreenData({ date }),
    openPlayRotationService.getRotationBoardData(date),
    playerTabService.listTabsForDate(date),
    saleService.listPaymentMethods(),
  ]);

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
      <RotationBoard {...serializeBoard(dateParam, board)} />
      <TabsPanel tabs={serializeTabs(tabs)} paymentMethods={paymentMethods.map((pm) => ({ id: pm.id, label: pm.label }))} />
    </div>
  );
}

function serializeTabs(tabs: (PlayerTab & { totalCents: number; gamesPlayed: number })[]) {
  return tabs.map((tab) => ({
    id: tab.id,
    playerName: tab.playerName,
    status: tab.status,
    totalCents: tab.totalCents,
    gamesPlayed: tab.gamesPlayed,
    settledVia: tab.settledVia,
  }));
}

function serializeAssignment(assignment: GameAssignmentWithParticipants) {
  return {
    id: assignment.id,
    source: assignment.source,
    status: assignment.status,
    skillSpread: assignment.skillSpread,
    startedAt: assignment.startedAt ? assignment.startedAt.toISOString() : null,
    participants: assignment.participants.map((p) => ({
      registrationId: p.registrationId,
      playerName: p.registration.playerName,
      skillLevel: p.registration.skillLevel,
    })),
  };
}

function serializeBoard(dateParam: string, board: RotationBoardData) {
  return {
    date: dateParam,
    courts: board.courts.map((c) => ({
      id: c.court.id,
      name: c.court.name,
      active: c.active ? serializeAssignment(c.active) : null,
      proposed: c.proposed ? serializeAssignment(c.proposed) : null,
    })),
    waiting: board.waiting,
    resting: board.resting,
    maxWaitMinutes: board.maxWaitMinutes,
    unfillableQueueReason: board.unfillableQueueReason,
  };
}

function serializeRegistrations<T extends { checkedInAt: Date | null }>(
  registrations: T[],
): (Omit<T, "checkedInAt"> & { checkedInAt: string | null })[] {
  return registrations.map((registration) => ({
    ...registration,
    checkedInAt: registration.checkedInAt ? registration.checkedInAt.toISOString() : null,
  }));
}
