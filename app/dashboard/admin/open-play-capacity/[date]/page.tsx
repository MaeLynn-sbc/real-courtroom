import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { CheckInPanel } from "@/features/open-play-capacity/components/checkin-panel";
import { ClosedMessageField } from "@/features/open-play-capacity/components/closed-message-field";
import { CloseSessionButton } from "@/features/open-play-capacity/components/close-session-button";
import { OnlineRegistrationBlockToggle } from "@/features/open-play-capacity/components/online-registration-block-toggle";
import { OpenPlayDateNav } from "@/features/open-play-capacity/components/open-play-date-nav";
import { OpenPlaySessionTabs } from "@/features/open-play-capacity/components/open-play-session-tabs";
import { OpenTabsCarryoverBanner } from "@/features/open-play-capacity/components/open-tabs-carryover-banner";
import { RegistrationRosterPanel } from "@/features/open-play-capacity/components/registration-roster-panel";
import { RotationBoard } from "@/features/open-play-capacity/components/rotation-board";
import { TabsPanel } from "@/features/open-play-capacity/components/tabs-panel";
import {
  WalkInRegistrationForm,
  type RegistrablePlayer,
} from "@/features/open-play-capacity/components/walk-in-registration-form";
import type { PlayerTab } from "@/lib/generated/prisma/client";
import { isBeforeFridaySaturdayOpenPlayCutoff } from "@/lib/court-hours";
import { shouldShowCarryoverBanner } from "@/lib/open-play-carryover";
import { toSettlementPaymentMethodOptions } from "@/lib/settlement-payment-methods";
import type {
  GameAssignmentWithParticipants,
  RotationBoardData,
} from "@/services/open-play/open-play-rotation.service";
import { isRegistrationOccupyingSeat } from "@/lib/open-play-seats";
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

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function toDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Decision logic (lib/open-play-carryover.ts) is pure and unit-tested
// directly — this wrapper only adds the DB fetch. Owner-reported
// follow-up (2026-08-08): no longer gated on today having zero tabs of
// its own — see shouldShowCarryoverBanner's own comment for why that
// used to let the warning go silent too easily.
async function findCarryoverBanner(
  previousDate: Date,
  previousDateValue: string,
): Promise<{ dateValue: string; label: string } | null> {
  const previousTabs = await playerTabService.listTabsForDate(previousDate);
  if (!shouldShowCarryoverBanner(previousTabs.map((tab) => tab.status))) {
    return null;
  }
  return { dateValue: previousDateValue, label: labelFormatter.format(previousDate) };
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

  const previousDate = addDays(date, -1);
  const previousDateValue = toDateValue(previousDate);
  const nextDateValue = toDateValue(addDays(date, 1));

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
    const [
      { registrations, skillBreakdown },
      { expected, checkedIn },
      board,
      tabs,
      paymentMethods,
      products,
      refreshIntervalSeconds,
    ] = await Promise.all([
      openPlayRegistrationService.getSessionRegistrations(session.id),
      openPlayCheckinService.getCheckInScreenData({ sessionId: session.id, date: session.date }),
      openPlayRotationService.getRotationBoardData(date),
      playerTabService.listTabsForDate(date),
      saleService.listPaymentMethods(),
      productService.listActiveProducts(),
      // Same interval the TV display's own auto-refresh already uses
      // (owner-editable) — see OpenPlaySessionTabs's own comment.
      settingsService.getDisplayRefreshIntervalSeconds(),
    ]);
    const hasUnsettledTabs = tabs.some((t) => t.status === "OPEN" && t.totalCents > 0);
    const now = new Date();
    const occupiedCount = registrations.filter((r) => isRegistrationOccupyingSeat(r, now)).length;
    const waitlistedCount = registrations.filter((r) => r.waitlistPos !== null).length;
    const carryoverBanner = await findCarryoverBanner(previousDate, previousDateValue);

    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        {carryoverBanner ? <OpenTabsCarryoverBanner {...carryoverBanner} /> : null}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              href="/dashboard/admin/open-play-capacity"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              ‹ Open Play Capacity
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              {labelFormatter.format(session.date)}
            </h1>
            <p className="text-muted-foreground text-sm">
              {occupiedCount} / {session.capacity} seats · {waitlistedCount} waiting ·{" "}
              {session.status}
            </p>
            <div className="mt-2 flex flex-col gap-3">
              <OpenPlayDateNav dateValue={dateParam} prevDateValue={previousDateValue} nextDateValue={nextDateValue} />
              <OnlineRegistrationBlockToggle
                date={dateParam}
                blocked={session.onlineRegistrationBlocked}
              />
              <ClosedMessageField date={dateParam} message={session.closedMessage} />
            </div>
          </div>
          {session.status === "OPEN" ? (
            <CloseSessionButton sessionId={session.id} disabled={hasUnsettledTabs} />
          ) : null}
        </div>

        <OpenPlaySessionTabs
          expectedNotCheckedInCount={expected.length}
          refreshIntervalSeconds={refreshIntervalSeconds}
          rotation={
            <RotationBoard
              {...serializeBoard(dateParam, board, openPlaySettings.targetGameMinutes)}
            />
          }
          checkIn={
            <div className="flex flex-col gap-4">
              {/* URGENT (reported live): before the cutoff, a customer at
                  the desk wanting to prepay for TONIGHT's unlimited
                  session had no form to use — only the regular
                  (playing-now) form rendered. Both are real, different
                  needs and both must be reachable before 6PM: someone
                  playing right now (regular, per-game) and someone
                  prepaying for tonight (unlimited, capacity night). After
                  the cutoff, Open Play has taken the courts over, so only
                  the unlimited form makes sense — matches
                  getCourtBookingWindow's own Fri/Sat rule. */}
              {walkInRegularMode ? (
                <>
                  <WalkInRegistrationForm
                    formId="regularWalkIn"
                    title="Register a walk-in (playing now)"
                    target={{ date: dateParam }}
                    players={players}
                    weeknightGameRateCents={openPlaySettings.weeknightGameRateCents}
                  />
                  <WalkInRegistrationForm
                    formId="unlimitedWalkIn"
                    title="Register for tonight's unlimited session"
                    target={{ sessionId: session.id }}
                    players={players}
                    paymentMethods={toSettlementPaymentMethodOptions(paymentMethods)}
                    friSatRegistrationFeeCents={openPlaySettings.friSatRegistrationFeeCents}
                  />
                </>
              ) : (
                <WalkInRegistrationForm
                  target={{ sessionId: session.id }}
                  players={players}
                  paymentMethods={toSettlementPaymentMethodOptions(paymentMethods)}
                  weeknightGameRateCents={openPlaySettings.weeknightGameRateCents}
                  friSatRegistrationFeeCents={openPlaySettings.friSatRegistrationFeeCents}
                />
              )}
              <CheckInPanel
                expected={serializeRegistrations(expected)}
                checkedIn={serializeRegistrations(checkedIn)}
                isCapacityNight
              />
            </div>
          }
          tabs={
            <TabsPanel
              tabs={serializeTabs(tabs)}
              paymentMethods={toSettlementPaymentMethodOptions(paymentMethods)}
              products={products.map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents }))}
            />
          }
          roster={
            <RegistrationRosterPanel
              registrations={registrations}
              skillBreakdown={skillBreakdown}
              capacity={session.capacity}
            />
          }
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
  const carryoverBanner = await findCarryoverBanner(previousDate, previousDateValue);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {carryoverBanner ? <OpenTabsCarryoverBanner {...carryoverBanner} /> : null}
      <div>
        {/* This regular-open-play branch has no list/roster page of its
            own to go "back" to the way Fri/Sat's own branch does
            (below) — it's reached directly from the "Regular Open
            Play" nav entry by default, though OpenPlayDateNav below now
            reaches any other date without a URL edit (incident, reported
            live: the nav entry always resolves to the server's current
            calendar date, which stops pointing at a still-open session
            right after midnight). Pointing "Back" at
            /dashboard/admin/open-play-capacity (now Fri/Sat-only, per the
            nav split) would be actively wrong, not just stale, so this
            goes back to the dashboard instead. */}
        <Link href="/dashboard" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ‹ Back to Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {labelFormatter.format(date)}
        </h1>
        <p className="text-muted-foreground text-sm">
          Regular drop-in — no capacity, no prepayment.
        </p>
        <div className="mt-2">
          <OpenPlayDateNav dateValue={dateParam} prevDateValue={previousDateValue} nextDateValue={nextDateValue} />
        </div>
      </div>

      <WalkInRegistrationForm
        target={{ date: dateParam }}
        players={players}
        showRegisterOnly={false}
        weeknightGameRateCents={openPlaySettings.weeknightGameRateCents}
      />
      <CheckInPanel
        expected={serializeRegistrations(expected)}
        checkedIn={serializeRegistrations(checkedIn)}
      />
      <RotationBoard {...serializeBoard(dateParam, board, openPlaySettings.targetGameMinutes)} />
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
    registrationId: tab.registrationId,
    playerName: tab.playerName,
    status: tab.status,
    totalCents: tab.totalCents,
    gamesPlayed: tab.gamesPlayed,
    settledVia: tab.settledVia,
  }));
}

function serializeAssignment(
  assignment: GameAssignmentWithParticipants,
  nudgeMinutes: number,
  targetGameMinutes: number,
) {
  const waitingToStart =
    assignment.status === "PROPOSED" &&
    Date.now() - assignment.proposedAt.getTime() >= nudgeMinutes * 60_000;
  // Court timer, staff-facing: same targetGameMinutes soft target the TV
  // display's own countdown uses (display.service.ts's identical
  // start + targetGameMinutes computation) — a shared setting, not a
  // second one invented here, so the two screens never disagree. Only
  // meaningful once a game is actually ACTIVE (has a real startedAt);
  // a PROPOSED group hasn't started its clock yet.
  const endAt =
    assignment.status === "ACTIVE" && assignment.startedAt
      ? new Date(assignment.startedAt.getTime() + targetGameMinutes * 60_000).toISOString()
      : null;
  return {
    id: assignment.id,
    source: assignment.source,
    status: assignment.status,
    skillSpread: assignment.skillSpread,
    startedAt: assignment.startedAt ? assignment.startedAt.toISOString() : null,
    endAt,
    announcementRequestedAt: assignment.announcementRequestedAt
      ? assignment.announcementRequestedAt.toISOString()
      : null,
    timesUpRequestedAt: assignment.timesUpRequestedAt
      ? assignment.timesUpRequestedAt.toISOString()
      : null,
    // Manual timer/announce forgotten-assignment nudge: computed here,
    // at render time, not pushed to the client as raw proposedAt +
    // minutes — this page now re-renders on the tab wrapper's own
    // auto-poll (OpenPlaySessionTabs), so "now" at serialization time
    // stays fresh automatically every refresh, same as before.
    waitingToStart,
    participants: assignment.participants.map((p) => ({
      registrationId: p.registrationId,
      playerName: p.registration.playerName,
      skillLevel: p.registration.skillLevel,
    })),
  };
}

function serializeBoard(dateParam: string, board: RotationBoardData, targetGameMinutes: number) {
  return {
    date: dateParam,
    courts: board.courts.map((c) => ({
      id: c.court.id,
      name: c.court.name,
      active: c.active
        ? serializeAssignment(c.active, board.forgottenAssignmentNudgeMinutes, targetGameMinutes)
        : null,
      proposed: c.proposed
        ? serializeAssignment(c.proposed, board.forgottenAssignmentNudgeMinutes, targetGameMinutes)
        : null,
      booked: c.booked,
    })),
    waiting: board.waiting,
    resting: board.resting,
    maxWaitMinutes: board.maxWaitMinutes,
    unfillableQueueReason: board.unfillableQueueReason,
    stagedGroups: board.stagedGroups.map((group) => ({
      id: group.id,
      slot: group.slot,
      source: group.source,
      members: group.members,
    })),
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
