import { computeBusinessDate } from "@/lib/business-date";
import { getFacilityCloseMinutes } from "@/lib/court-hours";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type {
  OpenPlayCapacityDefault,
  OpenPlayNightSession,
  Prisma,
} from "@/lib/generated/prisma/client";
import { openPlayRegistrationService } from "@/services/open-play/open-play-registration.service";
import { playerTabService } from "@/services/open-play/player-tab.service";
import { settingsService } from "@/services/settings/settings.service";

// BUILD-SPEC.md §4 — Friday/Saturday only. See prisma/schema.prisma's
// comment above OpenPlayCapacityDefault/OpenPlayNightSession for why this
// is a separate model set from the existing OpenPlaySession rotation
// feature (services/open-play/session.service.ts), not an extension of it.
const OPEN_PLAY_DAYS_OF_WEEK = [5, 6] as const;
type OpenPlayDayOfWeek = (typeof OPEN_PLAY_DAYS_OF_WEEK)[number];

function isOpenPlayDayOfWeek(dayOfWeek: number): dayOfWeek is OpenPlayDayOfWeek {
  return (OPEN_PLAY_DAYS_OF_WEEK as readonly number[]).includes(dayOfWeek);
}

function toMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// Date#setMinutes normalizes overflow itself (e.g. 1440 rolls to the next
// calendar day's 00:00), so a facility close of "00:00" (midnight) doesn't
// need special-casing here the way lib/court-hours.ts has to for booking
// windows.
function atMinutesOfDay(date: Date, minutes: number): Date {
  const result = toMidnight(date);
  result.setMinutes(minutes);
  return result;
}

interface AuditLogEntry {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// Matches the duck-typed check already used by booking.service.ts,
// locker-rental.service.ts, match.service.ts, equipment-rental.service.ts,
// and open-play-checkin.service.ts's own copy.
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export interface UpcomingOpenPlayNight {
  date: Date;
  dayOfWeek: OpenPlayDayOfWeek;
  capacity: number;
  isOverride: boolean;
  status: OpenPlayNightSession["status"] | null;
  // Gate 2 review follow-up: closes the blind spot between an online
  // registration landing (possibly weeks before the night, once the
  // lead-time window opens) and staff ever navigating to that specific
  // date's roster to see it. 0 for any date with no session row yet —
  // registration/waitlist rows can't exist without one.
  registeredCount: number;
  waitlistedCount: number;
  // Date-specific override — false for any date with no session row yet
  // (nothing has ever blocked it). See
  // setOnlineRegistrationBlockedForDate's own comment for the full
  // picture of how this differs from the feature-wide switch and the
  // day-of-week default.
  onlineRegistrationBlocked: boolean;
  // Per-date closed-message override — null for any date with no session
  // row yet, or one that's never had a message set. Resolve against the
  // global default via resolveOpenPlayClosedMessage
  // (lib/open-play-closed-message.ts), never render this raw.
  closedMessage: string | null;
  // Owner-reported incident (2026-08-08, ~12am): a night still OPEN past
  // midnight used to fall off this list the instant the calendar rolled
  // over, even with real players still checked in — the forward-only
  // date cursor below had no way to know the difference between "hasn't
  // started yet" and "already ended." True only for a session dated
  // BEFORE today that's still status OPEN (closeSession refuses to close
  // one with unsettled tabs, so OPEN here means genuinely still running,
  // not just forgotten) — every other entry in this list is false.
  stillRunning: boolean;
}

export class OpenPlayCapacityService {
  async getCapacityDefaults(): Promise<OpenPlayCapacityDefault[]> {
    return prisma.openPlayCapacityDefault.findMany({ orderBy: { dayOfWeek: "asc" } });
  }

  // BUILD-SPEC.md §4 "Accept any positive integer. Do not cap input at 40"
  // — validated by the caller's zod schema, not re-validated here.
  async setCapacityDefault(
    dayOfWeek: OpenPlayDayOfWeek,
    capacity: number,
    actorUserId: string,
  ): Promise<OpenPlayCapacityDefault> {
    const existing = await prisma.openPlayCapacityDefault.findUnique({ where: { dayOfWeek } });

    const updated = await prisma.openPlayCapacityDefault.upsert({
      where: { dayOfWeek },
      update: { capacity },
      create: { dayOfWeek, capacity },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_capacity_default.updated",
      entityType: "OpenPlayCapacityDefault",
      entityId: updated.id,
      oldValues: existing ? { capacity: existing.capacity } : null,
      newValues: { dayOfWeek, capacity },
    });

    return updated;
  }

  // Open-play online self-registration, Gate 1 follow-up (BUILD-SPEC.md
  // §6). A narrower, independent question from setCapacityDefault above:
  // whether THIS capacity night (already hardcoded to Fri/Sat —
  // OPEN_PLAY_DAYS_OF_WEEK, this file's own top-of-file comment) also
  // offers online registration. Not read by any registration path yet —
  // the feature-wide switch (settingsService.
  // getOpenPlayOnlineRegistrationEnabled) still gates all of it; this is
  // the second, per-day gate a later gate's service code will also check.
  async setOnlineRegistrationEnabledForDay(
    dayOfWeek: OpenPlayDayOfWeek,
    enabled: boolean,
    actorUserId: string,
  ): Promise<OpenPlayCapacityDefault> {
    const existing = await prisma.openPlayCapacityDefault.findUnique({ where: { dayOfWeek } });

    const updated = await prisma.openPlayCapacityDefault.upsert({
      where: { dayOfWeek },
      update: { onlineRegistrationEnabled: enabled },
      create: { dayOfWeek, capacity: 0, onlineRegistrationEnabled: enabled },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_capacity_default.online_registration_toggled",
      entityType: "OpenPlayCapacityDefault",
      entityId: updated.id,
      oldValues: existing
        ? { onlineRegistrationEnabled: existing.onlineRegistrationEnabled }
        : null,
      newValues: { dayOfWeek, onlineRegistrationEnabled: enabled },
    });

    return updated;
  }

  // Date-specific online-registration blockout — independent of both
  // the feature-wide switch and setOnlineRegistrationEnabledForDay's
  // day-of-week default above. "This particular Friday is a
  // tournament, no online registration that night" even though
  // Fridays are normally open. Walk-in/staff registration is
  // untouched — createPublicOpenPlayRegistration is the only reader.
  async setOnlineRegistrationBlockedForDate(
    date: Date,
    blocked: boolean,
    actorUserId: string,
  ): Promise<OpenPlayNightSession> {
    const session = await this.getOrCreateSessionForDate(date);

    const updated = await prisma.openPlayNightSession.update({
      where: { id: session.id },
      data: { onlineRegistrationBlocked: blocked },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_session.online_registration_blocked_toggled",
      entityType: "OpenPlayNightSession",
      entityId: session.id,
      oldValues: { onlineRegistrationBlocked: session.onlineRegistrationBlocked },
      newValues: { onlineRegistrationBlocked: blocked },
    });

    return updated;
  }

  // Per-date closed-message override, independent of the block toggle
  // above on purpose — an owner can write the message ahead of a night
  // being blocked, or leave a message parked without ever flipping the
  // switch. Same "get-or-create, then a scoped update touching only
  // this one column" shape as setOnlineRegistrationBlockedForDate —
  // NOT an upsert, so the two setters can never race each other into
  // wiping the other's column: getOrCreateSessionForDate always returns
  // the SAME existing row once one exists (see its own comment), and
  // this update's `data` only ever names closedMessage.
  // A blank/whitespace-only message is stored as null (falls back to
  // the global default), not as an empty string — resolveOpenPlayClosedMessage
  // does the same trim defensively at read time, but storing null here
  // means "cleared" is also what an owner sees if they inspect the row
  // directly, not an empty-but-truthy string.
  async setClosedMessageForDate(
    date: Date,
    message: string,
    actorUserId: string,
  ): Promise<OpenPlayNightSession> {
    const session = await this.getOrCreateSessionForDate(date);
    const trimmed = message.trim();
    const nextMessage = trimmed.length > 0 ? trimmed : null;

    const updated = await prisma.openPlayNightSession.update({
      where: { id: session.id },
      data: { closedMessage: nextMessage },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_session.closed_message_updated",
      entityType: "OpenPlayNightSession",
      entityId: session.id,
      oldValues: { closedMessage: session.closedMessage },
      newValues: { closedMessage: nextMessage },
    });

    return updated;
  }

  // Owner request (2026-08-08): "sometimes we want open play at earlier
  // times" — a real, ENFORCED override of when courts stop being
  // bookable for that specific date, not just a display change. See
  // startAtOverridden's own schema comment for why this is a deliberate
  // opt-in per date rather than "any existing session row is an
  // override" the way capacity already works. startTime is a "HH:MM"
  // string, same convention as CourtHoursSettings.fridaySaturdayCloseTime
  // — parsed and validated against this date's own facility close time
  // (getEffectiveFridaySaturdayEndMinutes below reads the SAME endAt,
  // never overridden by this method) so an override can never be set
  // past when the building itself closes.
  async overrideSessionStartTime(
    date: Date,
    startTime: string,
    actorUserId: string,
  ): Promise<OpenPlayNightSession> {
    const session = await this.getOrCreateSessionForDate(date);
    const startMinutes = parseTimeToMinutes(startTime);
    const endMinutes = session.endAt.getHours() * 60 + session.endAt.getMinutes();
    if (startMinutes >= (endMinutes === 0 ? 24 * 60 : endMinutes)) {
      throw new Error("Start time must be before the facility closes that night.");
    }

    const newStartAt = atMinutesOfDay(session.date, startMinutes);
    const updated = await prisma.openPlayNightSession.update({
      where: { id: session.id },
      data: { startAt: newStartAt, startAtOverridden: true },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_session.start_time_overridden",
      entityType: "OpenPlayNightSession",
      entityId: session.id,
      oldValues: { startAt: session.startAt, startAtOverridden: session.startAtOverridden },
      newValues: { startAt: newStartAt, startAtOverridden: true },
    });

    return updated;
  }

  // Reverts to the live-computed default (same formula
  // getOrCreateSessionForDate itself uses) — for when staff want this
  // date to stop being a special case and just follow the normal
  // fridaySaturdayCloseTime setting again, including picking up any
  // change to that setting made since the override was set.
  async resetSessionStartTime(date: Date, actorUserId: string): Promise<OpenPlayNightSession> {
    const session = await this.getOrCreateSessionForDate(date);
    const courtHours = await settingsService.getCourtHours();
    const newStartAt = atMinutesOfDay(session.date, parseTimeToMinutes(courtHours.fridaySaturdayCloseTime));

    const updated = await prisma.openPlayNightSession.update({
      where: { id: session.id },
      data: { startAt: newStartAt, startAtOverridden: false },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_session.start_time_reset",
      entityType: "OpenPlayNightSession",
      entityId: session.id,
      oldValues: { startAt: session.startAt, startAtOverridden: session.startAtOverridden },
      newValues: { startAt: newStartAt, startAtOverridden: false },
    });

    return updated;
  }

  // The resolver every court-booking-cutoff call site consults, ONCE per
  // page load/request (never per grid cell — see getCourtBookingWindow's
  // own "no query per cell" comment) — undefined means "no override,
  // use the live global setting," exactly like every other caller
  // already does today. Non-Fri/Sat dates always return undefined: this
  // override only ever exists for Open Play nights.
  async getStartTimeOverrideMinutes(date: Date): Promise<number | undefined> {
    const dayOfWeek = date.getDay();
    if (!isOpenPlayDayOfWeek(dayOfWeek)) {
      return undefined;
    }
    const session = await prisma.openPlayNightSession.findUnique({ where: { date: toMidnight(date) } });
    if (!session?.startAtOverridden) {
      return undefined;
    }
    return session.startAt.getHours() * 60 + session.startAt.getMinutes();
  }

  // "One per date. Created on demand from the weekday default" — nothing
  // pre-populates future Friday/Saturday rows; this is the sole entry
  // point that materializes one, called either by an owner setting a
  // per-date override (Phase 3) or by registration once that exists
  // (Phase 4).
  async getOrCreateSessionForDate(rawDate: Date): Promise<OpenPlayNightSession> {
    const date = toMidnight(rawDate);
    const dayOfWeek = date.getDay();
    if (!isOpenPlayDayOfWeek(dayOfWeek)) {
      throw new Error("Open play nights only exist for Friday and Saturday.");
    }

    const existing = await prisma.openPlayNightSession.findUnique({ where: { date } });
    if (existing) {
      return existing;
    }

    const [capacityDefault, courtHours] = await Promise.all([
      prisma.openPlayCapacityDefault.findUnique({ where: { dayOfWeek } }),
      settingsService.getCourtHours(),
    ]);
    if (!capacityDefault) {
      // Seed data is expected to always have Fri/Sat rows — a missing one
      // is a real configuration bug, not something to silently guess a
      // fallback capacity for.
      throw new Error(
        `No OpenPlayCapacityDefault configured for day ${dayOfWeek} — check prisma/seed.ts.`,
      );
    }

    const startAt = atMinutesOfDay(date, parseTimeToMinutes(courtHours.fridaySaturdayCloseTime));
    const endAt = atMinutesOfDay(date, getFacilityCloseMinutes(courtHours, date));

    try {
      return await prisma.openPlayNightSession.create({
        data: { date, startAt, endAt, capacity: capacityDefault.capacity },
      });
    } catch (error) {
      // Hardening phase fix (BUILD-SPEC.md §0 process rule): the
      // `existing` check above only protects a SEQUENTIAL race — two
      // concurrent calls for the same date both read `existing` as null
      // before either commits, so both attempt to create, and the loser
      // collides on OpenPlayNightSession.date's real unique constraint
      // instead of getting a graceful result. Owner-only and rare to
      // trigger concurrently, but same treatment as every other
      // benign-double-tap case in this audit: catch the specific case,
      // return the row the winner just created, don't surface a raw DB
      // error. Proven live
      // (open-play-capacity.concurrency.integration.ts): a concurrent
      // race threw "Unique constraint failed" 6/6 runs.
      if (isUniqueConstraintViolation(error)) {
        return prisma.openPlayNightSession.findUniqueOrThrow({ where: { date } });
      }
      throw error;
    }
  }

  // Sets (creating the row on demand if needed) a specific date's capacity
  // independently of the weekday default — BUILD-SPEC.md §4 "Owner can
  // override a single date without changing the default."
  //
  // Phase 4 note: once OpenPlayNightRegistration exists, this must reject
  // lowering capacity below the confirmed-registration count for this
  // session ("fail loudly... tell the owner how many are registered") —
  // there's nothing to count yet, so that guard isn't implemented here.
  async setSessionCapacityOverride(
    date: Date,
    capacity: number,
    actorUserId: string,
  ): Promise<OpenPlayNightSession> {
    const session = await this.getOrCreateSessionForDate(date);

    // Open-play online self-registration, Gate 2 (BUILD-SPEC.md §6): "a
    // slot frees ... or capacity raised" — wrapped in a transaction that
    // also locks the session row (same raw-SQL FOR UPDATE query
    // open-play-registration.service.ts's own lockSessionRow runs;
    // duplicated rather than imported across services, same precedent
    // as isUniqueConstraintViolation already being duplicated between
    // these two exact files) purely so inviteNextWaitlistEntry below can
    // safely read/write OpenPlayWaitlistEntry rows for this session
    // without racing a concurrent registerWalkIn/releaseRegistration.
    // Harmless when uncontended (this action is owner-only and rare —
    // this file's own existing comment on this method already says so),
    // and inert whenever the feature-wide switch is off, since no
    // OpenPlayWaitlistEntry row can exist in that state — proven in this
    // gate's hard-boundary check via the existing
    // open-play-capacity.concurrency.integration.ts suite passing
    // unmodified.
    const updated = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; date: Date; capacity: number }[]>`
        SELECT id, date, capacity FROM "OpenPlayNightSession" WHERE id = ${session.id} FOR UPDATE
      `;
      const locked = rows[0];
      if (!locked) {
        throw new Error("Open play night session not found.");
      }

      const result = await tx.openPlayNightSession.update({
        where: { id: session.id },
        data: { capacity },
      });

      // Only a genuine increase ever frees anything — lowering capacity
      // has its own separate, not-yet-built guard (this method's own
      // "Phase 4 note" above already flags that lowering below the
      // confirmed count isn't rejected yet; unrelated to this gate).
      if (capacity > locked.capacity) {
        await openPlayRegistrationService.inviteNextWaitlistEntry(
          tx,
          { id: session.id, date: locked.date },
          actorUserId,
        );
      }

      return result;
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_session.capacity_overridden",
      entityType: "OpenPlayNightSession",
      entityId: updated.id,
      oldValues: { capacity: session.capacity },
      newValues: { date: updated.date, capacity },
    });

    return updated;
  }

  // BUILD-SPEC.md §9 correctness #6 "A session cannot close while tabs are
  // open — warn and list them." Fri/Sat only — a weeknight has no session
  // to close. See BUILD-SPEC.md §9's "closing out the night" note for the
  // weeknight equivalent (there's no status to flip; the Unsettled tab
  // list itself, surfaced in the UI, is the whole mechanism).
  // Hardening phase fix (BUILD-SPEC.md §0 process rule): the "no open
  // tabs" check and the status write used to be two separate steps — a
  // tab could go from zero to non-zero (a game completing, a rental being
  // added) in the gap between them, closing a session with real money
  // still outstanding. This is the guard Phase 7 built specifically to
  // stop that (§9 correctness #6) — and the guard was itself check-then-
  // act, the clearest example in this whole audit of why it was needed.
  // Proven live before this fix (open-play-capacity.concurrency
  // .integration.ts): a session closed with a ₱20 open tab balance, 8/8
  // runs, no forced delay needed — the natural window is wide (the old
  // check does several round trips per tab).
  //
  // Fixed with one atomic conditional UPDATE, not a lock: locking would
  // need every tab-mutating method (creditGame, addRentalLineItem, ...)
  // to also acquire and respect the same lock to close the gap, a
  // cross-cutting change to methods this fix isn't scoped to touch.
  // Instead, the "still OPEN" and "no open tab has a balance" checks are
  // both evaluated by Postgres as part of the SAME statement, atomically
  // — there is no gap between "check" and "write" because they are the
  // same operation. If a charge commits a moment before this statement
  // runs, the subquery sees it and zero rows update. If a charge commits
  // a moment after, this statement already committed CLOSED first — the
  // race is resolved by whichever actually wins at the database, not by
  // a stale read in application code.
  async closeSession(sessionId: string, actorUserId: string): Promise<OpenPlayNightSession> {
    const session = await prisma.openPlayNightSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    if (session.status !== "OPEN") {
      throw new Error(`Session is already ${session.status.toLowerCase()}.`);
    }

    const claimed = await prisma.$executeRaw`
      UPDATE "OpenPlayNightSession"
      SET status = 'CLOSED'
      WHERE id = ${sessionId}
        AND status = 'OPEN'
        AND NOT EXISTS (
          SELECT 1 FROM "PlayerTab" pt
          WHERE pt."sessionId" = ${sessionId}
            AND pt.status = 'OPEN'
            AND (
              SELECT COALESCE(SUM(li."amountCents"), 0)
              FROM "TabLineItem" li
              WHERE li."tabId" = pt.id
            ) > 0
        )
    `;

    if (claimed === 0) {
      // Distinguish the two reasons this can fail, for a useful error —
      // both reads happen AFTER the atomic attempt, so they can't
      // themselves race with what already happened.
      const current = await prisma.openPlayNightSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      if (current.status !== "OPEN") {
        throw new Error(`Session is already ${current.status.toLowerCase()}.`);
      }
      const unsettled = await playerTabService.listUnsettledForDate(session.date);
      const names = unsettled.map((tab) => tab.playerName).join(", ");
      throw new Error(`Cannot close — ${unsettled.length} open tab(s) with a balance: ${names}.`);
    }

    const updated = await prisma.openPlayNightSession.findUniqueOrThrow({
      where: { id: sessionId },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_session.closed",
      entityType: "OpenPlayNightSession",
      entityId: sessionId,
      oldValues: { status: session.status },
      newValues: { status: "CLOSED" },
    });

    return updated;
  }

  // Upcoming Friday/Saturday dates for the owner-facing overrides UI —
  // doesn't materialize a session row just for viewing; `isOverride`
  // distinguishes "already has its own row" from "would inherit today's
  // default if a session were created right now."
  // Owner-directed consolidation (2026-08-12): rollover-hour aware, not
  // literal calendar midnight — same computeBusinessDate every other
  // correct part of the app uses. rolloverHour defaults to 0 (old
  // behavior) so the many integration tests exercising this method
  // don't need updating; every real production caller passes the real
  // setting.
  async getUpcomingNights(count: number, rolloverHour = 0): Promise<UpcomingOpenPlayNight[]> {
    const today = computeBusinessDate(new Date(), rolloverHour);
    const dates: Date[] = [];
    const cursor = new Date(today);
    while (dates.length < count) {
      if (isOpenPlayDayOfWeek(cursor.getDay())) {
        dates.push(new Date(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    const [sessions, stillOpenPastSessions, defaults] = await Promise.all([
      prisma.openPlayNightSession.findMany({ where: { date: { in: dates } } }),
      // See stillRunning's own comment on UpcomingOpenPlayNight — the
      // fix for the midnight-rollover incident. Not scoped to just
      // "yesterday": if a night was somehow left OPEN even longer (a
      // forgotten close-out), staff still need a way back to it.
      prisma.openPlayNightSession.findMany({
        where: { date: { lt: today }, status: "OPEN" },
        orderBy: { date: "asc" },
      }),
      this.getCapacityDefaults(),
    ]);
    const sessionsByDate = new Map(sessions.map((session) => [session.date.getTime(), session]));
    const defaultsByDay = new Map(defaults.map((row) => [row.dayOfWeek, row.capacity]));

    // Gate 2 review follow-up: registered/waitlisted counts per night,
    // so a night three weeks out that already has online registrations
    // is visible here without staff navigating to its specific roster.
    // Only sessions that already have a row can have any registrations
    // (sessionId is required on both models) — sessionIds is often
    // empty (most upcoming nights have no override yet), skip the
    // queries entirely rather than issue an `IN ()` against nothing.
    // Includes stillOpenPastSessions too, so a carried-over night's own
    // counts are accurate, not stuck at 0.
    const sessionIds = [...sessions, ...stillOpenPastSessions].map((session) => session.id);
    const now = new Date();
    const [registeredGroups, waitlistedGroups] =
      sessionIds.length > 0
        ? await Promise.all([
            // Same "occupied" predicate as countOccupiedSeats
            // (open-play-registration.service.ts) — CONFIRMED/
            // PENDING_VERIFICATION always count, an AWAITING_PAYMENT hold
            // only while its holdExpiresAt hasn't passed, walk-in-waitlist
            // rows (waitlistPos not null) excluded.
            prisma.openPlayNightRegistration.groupBy({
              by: ["sessionId"],
              where: {
                sessionId: { in: sessionIds },
                waitlistPos: null,
                OR: [
                  { status: "CONFIRMED" },
                  { status: "PENDING_VERIFICATION" },
                  { status: "AWAITING_PAYMENT", holdExpiresAt: { gte: now } },
                ],
              },
              _count: { _all: true },
            }),
            prisma.openPlayWaitlistEntry.groupBy({
              by: ["sessionId"],
              where: { sessionId: { in: sessionIds }, status: "WAITING" },
              _count: { _all: true },
            }),
          ])
        : [[], []];
    const registeredBySession = new Map(
      registeredGroups.map((row) => [row.sessionId, row._count._all]),
    );
    const waitlistedBySession = new Map(
      waitlistedGroups.map((row) => [row.sessionId, row._count._all]),
    );

    const stillOpenNights: UpcomingOpenPlayNight[] = stillOpenPastSessions.map((session) => ({
      date: session.date,
      dayOfWeek: session.date.getDay() as OpenPlayDayOfWeek,
      capacity: session.capacity,
      isOverride: true,
      status: session.status,
      registeredCount: registeredBySession.get(session.id) ?? 0,
      waitlistedCount: waitlistedBySession.get(session.id) ?? 0,
      onlineRegistrationBlocked: session.onlineRegistrationBlocked,
      closedMessage: session.closedMessage,
      stillRunning: true,
    }));

    const upcomingNights: UpcomingOpenPlayNight[] = dates.map((date) => {
      const dayOfWeek = date.getDay() as OpenPlayDayOfWeek;
      const session = sessionsByDate.get(date.getTime());
      return {
        date,
        dayOfWeek,
        capacity: session?.capacity ?? defaultsByDay.get(dayOfWeek) ?? 0,
        isOverride: Boolean(session),
        status: session?.status ?? null,
        registeredCount: session ? (registeredBySession.get(session.id) ?? 0) : 0,
        waitlistedCount: session ? (waitlistedBySession.get(session.id) ?? 0) : 0,
        onlineRegistrationBlocked: session?.onlineRegistrationBlocked ?? false,
        closedMessage: session?.closedMessage ?? null,
        stillRunning: false,
      };
    });

    return [...stillOpenNights, ...upcomingNights];
  }

  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          oldValues: toJsonValue(entry.oldValues),
          newValues: toJsonValue(entry.newValues),
        },
      });
    } catch (error) {
      logger.error(
        { err: error, action: entry.action, userId: entry.actorUserId },
        "Failed to write audit log entry",
      );
    }
  }
}

export const openPlayCapacityService = new OpenPlayCapacityService();
