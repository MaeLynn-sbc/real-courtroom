import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { CheckInPanel } from "@/features/open-play-capacity/components/checkin-panel";
import { CloseSessionButton } from "@/features/open-play-capacity/components/close-session-button";
import { OnlineRegistrationBlockToggle } from "@/features/open-play-capacity/components/online-registration-block-toggle";
import { RegistrationRosterPanel } from "@/features/open-play-capacity/components/registration-roster-panel";
import { RotationBoard } from "@/features/open-play-capacity/components/rotation-board";
import { TabsPanel } from "@/features/open-play-capacity/components/tabs-panel";
import { WalkInRegistrationForm, type RegistrablePlayer } from "@/features/open-play-capacity/components/walk-in-registration-form";
import type { PlayerTab } from "@/lib/generated/prisma/client";
import { isBeforeFridaySaturdayOpenPlayCutoff } from "@/lib/court-hours";
import { toSettlementPaymentMethodOptions } from "@/lib/settlement-payment-methods";
import type { GameAssignmentWithParticipants, RotationBoardData } from "@/services/open-play/open-play-rotation.service";
import { openPlayCapacityService } from "@/services/open-play/open-play-capacity.service";
import { openPlayCheckinService } from "@/services/open-play/open-play-checkin.service";
import { openPlayRegistrationService } from "@/services/open-play/open-play-registration.service";
import { openPlayRotationService } from "@/services/open-play/open-play-rotation.service";
import { playerTabService } from "@/services/open-play/player-tab.service";
import { playerService } from "@/services/player/player.service";
import { productService } from "@/services/products/product.service";
import { saleService } from "@/services/sales/sale.service";
import { settingsService } from "@/services/settings/settings.service";

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
  // No phone filter — a player missing a phone number should still be
  // searchable/selectable (prefills an empty phone field, same as a
  // guest); excluding them made the combobox unusable whenever players
  // don't have phones on file.
  return players.map((player) => ({
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
  const [players, openPlaySettings] = await Promise.all([
    playerService.listPlayers().then(toRegistrablePlayers),
    settingsService.getOpenPlaySettings(),
  ]);

  if (isCapacityNight) {
    // Reported live: walk-in registration was always routed into the
    // P150 unlimited capacity system on a Fri/Sat date, at every hour —
    // this page only ever checked the calendar date, never whether Open
    // Play had actually taken over the courts yet (see
    // isBeforeFridaySaturdayOpenPlayCutoff's own comment). Owner
    // decision: the capacity roster/queue/waitlist/tabs below stay
    // visible all day regardless (staff prep for the night during the
    // afternoon) — only the walk-in FORM itself switches mode, same
    // cutoff getCourtBookingWindow already uses for Fri/Sat court
    // bookings, not a second guess at it.
    const courtHours = await settingsService.getCourtHours();
    const walkInRegularMode = isBeforeFridaySaturdayOpenPlayCutoff(courtHours, date, new Date());

    // Viewing the page materializes the session (if it doesn't already
    // exist) the same way an owner setting a per-date override does —
    // "one per date, created on demand" (BUILD-SPEC.md §5).
    const session = await openPlayCapacityService.getOrCreateSessionForDate(date);
    const [{ registrations, skillBreakdown }, { expected, checkedIn }, board, tabs, paymentMethods, products] = await Promise.all([
      openPlayRegistrationService.getSessionRegistrations(session.id),
      openPlayCheckinService.getCheckInScreenData({ sessionId: session.id }),
      openPlayRotationService.getRotationBoardData(date),
      playerTabService.listTabsForDate(date),
      saleService.listPaymentMethods(),
      productService.listActiveProducts(),
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
            <div className="mt-2">
              <OnlineRegistrationBlockToggle date={dateParam} blocked={session.onlineRegistrationBlocked} />
            </div>
          </div>
          {session.status === "OPEN" ? (
            <CloseSessionButton sessionId={session.id} disabled={hasUnsettledTabs} />
          ) : null}
        </div>

        <WalkInRegistrationForm
          target={walkInRegularMode ? { date: dateParam } : { sessionId: session.id }}
          players={players}
          paymentMethods={toSettlementPaymentMethodOptions(paymentMethods)}
          weeknightGameRateCents={openPlaySettings.weeknightGameRateCents}
          friSatRegistrationFeeCents={openPlaySettings.friSatRegistrationFeeCents}
        />
        <CheckInPanel
          expected={serializeRegistrations(expected)}
          checkedIn={serializeRegistrations(checkedIn)}
          isCapacityNight
        />
        <RegistrationRosterPanel registrations={registrations} skillBreakdown={skillBreakdown} capacity={session.capacity} />
        <RotationBoard {...serializeBoard(dateParam, board)} />
        <TabsPanel
          tabs={serializeTabs(tabs)}
          paymentMethods={toSettlementPaymentMethodOptions(paymentMethods)}
          products={products.map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents }))}
        />
      </div>
    );
  }

  // Weeknight — BUILD-SPEC.md §0: no capacity, no waitlist, no
  // prepayment. Registration is optional and uncapped; most players just
  // walk in.
  const [{ expected, checkedIn }, board, tabs, paymentMethods, products] = await Promise.all([
    openPlayCheckinService.getCheckInScreenData({ date }),
    openPlayRotationService.getRotationBoardData(date),
    playerTabService.listTabsForDate(date),
    saleService.listPaymentMethods(),
    productService.listActiveProducts(),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        {/* This regular-open-play branch has no list/roster page of its
            own to go "back" to the way Fri/Sat's own branch does
            (below) — it's reached directly from the "Regular Open
            Play" nav entry, always for today, not from a list of other
            days. Pointing this at /dashboard/admin/open-play-capacity
            (now Fri/Sat-only, per the nav split) would be actively
            wrong, not just stale, so this goes back to the dashboard
            instead. */}
        <Link href="/dashboard" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ‹ Back to Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{labelFormatter.format(date)}</h1>
        <p className="text-muted-foreground text-sm">Regular drop-in — no capacity, no prepayment.</p>
      </div>

      <WalkInRegistrationForm
        target={{ date: dateParam }}
        players={players}
        showRegisterOnly={false}
        weeknightGameRateCents={openPlaySettings.weeknightGameRateCents}
      />
      <CheckInPanel expected={serializeRegistrations(expected)} checkedIn={serializeRegistrations(checkedIn)} />
      <RotationBoard {...serializeBoard(dateParam, board)} />
      <TabsPanel
        tabs={serializeTabs(tabs)}
        paymentMethods={toSettlementPaymentMethodOptions(paymentMethods)}
        products={products.map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents }))}
      />
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

function serializeAssignment(assignment: GameAssignmentWithParticipants, nudgeMinutes: number) {
  const waitingToStart =
    assignment.status === "PROPOSED" &&
    Date.now() - assignment.proposedAt.getTime() >= nudgeMinutes * 60_000;
  return {
    id: assignment.id,
    source: assignment.source,
    status: assignment.status,
    skillSpread: assignment.skillSpread,
    startedAt: assignment.startedAt ? assignment.startedAt.toISOString() : null,
    announcementRequestedAt: assignment.announcementRequestedAt ? assignment.announcementRequestedAt.toISOString() : null,
    // Manual timer/announce forgotten-assignment nudge: computed here,
    // at render time, not pushed to the client as raw proposedAt +
    // minutes — this page re-renders on each staff action (router.
    // refresh()) or manual reload, not a live poll, so "now" at
    // serialization time is the right, simplest signal, same as
    // getRotationBoardData's own pastMaxWait just above it.
    waitingToStart,
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
      active: c.active ? serializeAssignment(c.active, board.forgottenAssignmentNudgeMinutes) : null,
      proposed: c.proposed ? serializeAssignment(c.proposed, board.forgottenAssignmentNudgeMinutes) : null,
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
