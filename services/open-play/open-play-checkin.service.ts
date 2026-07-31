import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { OpenPlayNightRegistration, Prisma, QueueEntry } from "@/lib/generated/prisma/client";
import type { RaceHook } from "@/lib/race-test-hooks";
import {
  openPlayRegistrationService,
  type RegisterWalkInInput,
  type RegisterWalkInSaleContext,
} from "@/services/open-play/open-play-registration.service";
import { playerTabService } from "@/services/open-play/player-tab.service";
import { settingsService } from "@/services/settings/settings.service";

// BUILD-SPEC.md §6 "Registration and check-in" — check-in is what enters
// a player into the queue, not registration. Everything here operates on
// OpenPlayNightRegistration rows.

const UNDO_WINDOW_MS = 60_000;

// Payment-before-play gap (found by a report-only code audit, fixed
// here): a registration created via the online path can sit at
// AWAITING_PAYMENT (nobody's paid yet) or PENDING_VERIFICATION (proof
// submitted, not yet staff-approved) for a real stretch of time. Before
// this fix, checkIn() had no status check at all — only
// getCheckInScreenData's list query filtered to CONFIRMED, which
// controls what shows up on the staff UI, not what checkInAction will
// actually do if called directly against an unpaid/unverified
// registration's id. A walk-in never hits this: registerWalkIn/
// registerWeeknightWalkIn always create CONFIRMED rows before
// registerAndCheckIn calls checkIn.
export class RegistrationNotConfirmedError extends Error {
  constructor(status: string) {
    super(
      status === "AWAITING_PAYMENT"
        ? "This registration hasn't been paid yet — it can't be checked in."
        : status === "PENDING_VERIFICATION"
          ? "This registration's payment hasn't been verified yet — it can't be checked in."
          : `This registration can't be checked in (status: ${status}).`,
    );
    this.name = "RegistrationNotConfirmedError";
  }
}

// Owner decision (Fri/Sat waitlist rework): a waitlisted walk-in is
// registered at zero charge, with no real seat — it must not be
// checkable-in until staff explicitly promote it (which clears
// waitlistPos and, separately, collects the ₱150 fee). Same "guard the
// service method itself, not just the UI list" reasoning as
// RegistrationNotConfirmedError just above — getCheckInScreenData's own
// filter (below) already excludes a waitlisted row from what staff SEE,
// but this stops checkInAction from succeeding against one even if
// called directly.
export class RegistrationWaitlistedError extends Error {
  constructor() {
    super("This registration is on the waiting roster, not seated yet — it can't be checked in until promoted.");
    this.name = "RegistrationWaitlistedError";
  }
}

interface AuditLogEntry {
  actorUserId: string | null;
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
// locker-rental.service.ts, match.service.ts, equipment-rental.service.ts
// — avoids importing the generated PrismaClientKnownRequestError class
// just to read one field.
function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

export interface CheckInResult {
  registration: OpenPlayNightRegistration;
  queueEntriesCreated: QueueEntry[];
  alreadyCheckedIn: boolean;
}

export interface CheckInScreenData {
  expected: OpenPlayNightRegistration[]; // registered, not yet arrived
  checkedIn: OpenPlayNightRegistration[]; // arrived, ordered by checkedInAt (queue order)
}

// Permanent test-only seam (BUILD-SPEC.md §0/§15) — every field defaults
// to a no-op and no production call site passes any of these. Two hooks,
// not one, because they solve different problems:
//   - beforeRead: fires at the very top of the transaction, before any DB
//     work. A concurrency test passes a rendezvous barrier here so two
//     concurrent checkIn calls provably start their DB work at the same
//     instant — closing out connection-acquisition/scheduling jitter that
//     otherwise swamps the party path's naturally narrow race window.
//   - beforePartyDecision: fires right before the party branch decides
//     "has everyone arrived?". A no-op when the party lock is present
//     (this transaction already holds it, so a concurrent call is
//     blocked on the DB, not this hook) — widens the window if that lock
//     is ever regressed away.
export interface CheckInTestHooks {
  beforeRead?: RaceHook;
  beforePartyDecision?: RaceHook;
}

export class OpenPlayCheckinService {
  // Idempotent (BUILD-SPEC.md §6 correctness #3: "double-tapping creates
  // one entry") — a registration already checked in is a no-op, not an
  // error, so a busy desk can tap twice without consequence.
  //
  // Party-aware (§6 "Parties"): a party enters the queue only once every
  // active member shares checkedInAt != null; joinedQueueAt for the whole
  // party is the LAST member's check-in time, not each member's own —
  // deliberately the opposite of §5's waitlist rule, which uses the
  // earliest member (see schema.prisma's OpenPlayNightRegistration
  // comment and BUILD-SPEC.md §6's note contrasting the two).
  async checkIn(registrationId: string, actorUserId: string, testHooks: CheckInTestHooks = {}): Promise<CheckInResult> {
    let result: CheckInResult;
    try {
      result = await this.checkInTx(registrationId, actorUserId, testHooks);
    } catch (error) {
      // Hardening phase fix (BUILD-SPEC.md §0 process rule): the
      // `existing.checkedInAt` guard above only protects a SEQUENTIAL
      // double-tap. Two concurrent checkIn calls for the SAME
      // registration both read checkedInAt as null before either
      // commits, so both proceed — and collide on
      // QueueEntry.registrationId's or PlayerTab.registrationId's real
      // unique constraint instead. That constraint is exactly the
      // guarantee BUILD-SPEC.md §6 correctness #3 depends on, but the
      // losing side used to surface it as a raw, unhandled DB error
      // rather than the same graceful no-op the sequential path already
      // gets. Proven live
      // (open-play-checkin.concurrency.integration.ts): a concurrent
      // double-tap threw "Unique constraint failed" 6/6 runs. Same
      // treatment as AssignmentAlreadyCompletedError — catch the
      // specific benign case, re-read the now-committed state, no-op.
      if (isUniqueConstraintViolation(error)) {
        const current = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: registrationId } });
        return { registration: current, queueEntriesCreated: [], alreadyCheckedIn: true };
      }
      throw error;
    }

    if (!result.alreadyCheckedIn) {
      await this.writeAuditLog({
        actorUserId,
        action: "open_play_registration.checked_in",
        entityType: "OpenPlayNightRegistration",
        entityId: registrationId,
        newValues: { queueEntriesCreated: result.queueEntriesCreated.length },
      });
    }

    return result;
  }

  private async checkInTx(
    registrationId: string,
    actorUserId: string,
    testHooks: CheckInTestHooks = {},
  ): Promise<CheckInResult> {
    return prisma.$transaction(async (tx) => {
      await testHooks.beforeRead?.();

      const existing = await tx.openPlayNightRegistration.findUniqueOrThrow({ where: { id: registrationId } });

      if (existing.checkedInAt) {
        return { registration: existing, queueEntriesCreated: [] as QueueEntry[], alreadyCheckedIn: true };
      }

      // The guard itself (see RegistrationNotConfirmedError above) —
      // checked before the party lock/promotion logic below, so an
      // unpaid/unverified registration is refused before any of that
      // runs. This is the SAME status check the party branch already
      // applies to every OTHER member when deciding "has everyone
      // arrived" (status = 'CONFIRMED' in the raw SQL/findMany below) —
      // extended here to cover the registration actually being checked
      // in, which that existing check never did.
      if (existing.status !== "CONFIRMED") {
        throw new RegistrationNotConfirmedError(existing.status);
      }
      if (existing.waitlistPos !== null) {
        throw new RegistrationWaitlistedError();
      }

      // Hardening phase fix (BUILD-SPEC.md §0 process rule): the party
      // branch below used to decide "has everyone arrived?" from a plain,
      // unlocked findMany. Two members of the same party checking in at
      // the same moment each run in their OWN transaction — under READ
      // COMMITTED, neither can see the other's still-uncommitted update,
      // so both independently conclude "not everyone's here" and the
      // party never enters the queue at all, silently. Locking every
      // member of the party (stable id order, to avoid a deadlock cycle
      // against a concurrent check-in for the same party) BEFORE deciding
      // forces the two transactions to run one at a time — whichever
      // commits second then re-reads and correctly sees the first one's
      // already-committed arrival.
      if (existing.partyId) {
        await tx.$queryRaw`
          SELECT id FROM "OpenPlayNightRegistration"
          WHERE "partyId" = ${existing.partyId} AND date = ${existing.date} AND status = 'CONFIRMED'
          ORDER BY id
          FOR UPDATE
        `;
      }

      const now = new Date();
      const updated = await tx.openPlayNightRegistration.update({
        where: { id: registrationId },
        data: { checkedInAt: now },
      });

      if (!existing.partyId) {
        const entry = await tx.queueEntry.create({
          data: {
            registrationId: updated.id,
            sessionId: updated.sessionId,
            date: updated.date,
            playerName: updated.playerName,
            skillLevel: updated.skillLevel,
            partyId: null,
            joinedQueueAt: now,
          },
        });
        // BUILD-SPEC.md §6 "opens a PlayerTab (weeknight) or marks the
        // prepaid session used (Fri/Sat)" — every checked-in player gets a
        // tab ready to receive game/rental charges, regardless of night
        // type (Fri/Sat tabs just snapshot gameRateCents=0).
        await playerTabService.getOrCreateTab(updated.id, actorUserId, tx);
        return { registration: updated, queueEntriesCreated: [entry], alreadyCheckedIn: false };
      }

      await testHooks.beforePartyDecision?.();

      // Party — read AFTER updating `updated` above, so this read sees its
      // own write (same transaction): if this was the last member, every
      // row here now has checkedInAt set.
      const partyMembers = await tx.openPlayNightRegistration.findMany({
        where: { partyId: existing.partyId, date: existing.date, status: "CONFIRMED" },
      });
      const allArrived = partyMembers.every((member) => member.checkedInAt !== null);

      if (!allArrived) {
        return { registration: updated, queueEntriesCreated: [], alreadyCheckedIn: false };
      }

      const entries = await Promise.all(
        partyMembers.map((member) =>
          tx.queueEntry.create({
            data: {
              registrationId: member.id,
              sessionId: member.sessionId,
              date: member.date,
              playerName: member.playerName,
              skillLevel: member.skillLevel,
              partyId: member.partyId,
              joinedQueueAt: now,
            },
          }),
        ),
      );
      // Every party member gets a tab too, the moment the group completes
      // — not just the member whose check-in happened to be the last one.
      for (const member of partyMembers) {
        await playerTabService.getOrCreateTab(member.id, actorUserId, tx);
      }
      return { registration: updated, queueEntriesCreated: entries, alreadyCheckedIn: false };
    });
  }

  // BUILD-SPEC.md §6 "Undo for 60 seconds." Enforced server-side, not
  // just hidden client-side after the window — reverses the QueueEntry(s)
  // this exact check-in created, including un-completing a party (removes
  // every sibling entry created at the same joinedQueueAt, reverting them
  // to "not yet all arrived" rather than leaving orphaned entries).
  async undoCheckIn(registrationId: string, actorUserId: string): Promise<OpenPlayNightRegistration> {
    const reverted = await prisma.$transaction(async (tx) => {
      const existing = await tx.openPlayNightRegistration.findUniqueOrThrow({ where: { id: registrationId } });
      if (!existing.checkedInAt) {
        throw new Error("This registration hasn't been checked in.");
      }
      if (Date.now() - existing.checkedInAt.getTime() > UNDO_WINDOW_MS) {
        throw new Error("Check-in can only be undone within 60 seconds.");
      }

      const queueEntry = await tx.queueEntry.findUnique({ where: { registrationId } });
      if (queueEntry) {
        if (existing.partyId) {
          await tx.queueEntry.deleteMany({
            where: { partyId: existing.partyId, date: existing.date, joinedQueueAt: queueEntry.joinedQueueAt },
          });
        } else {
          await tx.queueEntry.delete({ where: { id: queueEntry.id } });
        }
      }

      return tx.openPlayNightRegistration.update({
        where: { id: registrationId },
        data: { checkedInAt: null },
      });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_registration.check_in_undone",
      entityType: "OpenPlayNightRegistration",
      entityId: registrationId,
    });

    return reverted;
  }

  // "A walk-in button that registers and checks in as one action — that's
  // how most weeknight players arrive" (BUILD-SPEC.md §6). Works for
  // either a Fri/Sat session (capacity-gated) or a weeknight date
  // (uncapped) depending on which is provided.
  // Gate 2 review follow-up: the Fri/Sat branch also collects the ₱150
  // registration fee (same as registerWalkIn's own "register only"
  // path — both create a CONFIRMED registration immediately, so both
  // owe the fee at that moment), so saleContext is REQUIRED on the
  // sessionId variant — bundled into the discriminated union itself
  // rather than a separate optional parameter, so "Fri/Sat without a
  // saleContext" is unrepresentable instead of a runtime check. The
  // weeknight (date) branch never carries one — no fee applies there.
  async registerAndCheckIn(
    target: { sessionId: string; saleContext: RegisterWalkInSaleContext } | { date: Date },
    input: RegisterWalkInInput,
    actorUserId: string,
  ): Promise<CheckInResult> {
    const registration =
      "sessionId" in target
        ? await openPlayRegistrationService.registerWalkIn(target.sessionId, input, actorUserId, target.saleContext)
        : await openPlayRegistrationService.registerWeeknightWalkIn(target.date, input, actorUserId);

    // Owner decision (Fri/Sat waitlist rework): a walk-in that lands on
    // the waiting roster (capacity full) has no seat to check into — the
    // "Walk-in (register & check in)" button is the same one staff use
    // for every walk-in regardless of whether the night turns out to be
    // full, so this must succeed as a registration without attempting
    // (and failing) a check-in RegistrationWaitlistedError would
    // otherwise correctly reject. Weeknight registrations never have a
    // waitlistPos (no capacity there), so this only ever short-circuits
    // the Fri/Sat branch.
    if (registration.waitlistPos !== null) {
      return { registration, queueEntriesCreated: [], alreadyCheckedIn: false };
    }

    return this.checkIn(registration.id, actorUserId);
  }

  // Owner decision (Fri/Sat waitlist rework): NO automatic no-show
  // release. Players legitimately arrive late (8pm+); a seat must never
  // free itself just because someone hasn't checked in yet by some
  // cutoff. This method is intentionally no longer called automatically
  // — see getCheckInScreenData below, which used to call it on every
  // read and no longer does. Kept in place (not deleted) as a real,
  // directly-callable method: markNoShowAction/the roster's own
  // "No-show" button already call openPlayRegistrationService.markNoShow
  // for a single registration, and this is the same release path, just
  // scoped to "everyone overdue" — useful if a genuine batch-release
  // need ever comes back, but nothing wires it in on its own anymore.
  // settingsService.getOpenPlaySettings().noShowReleaseMinutes is
  // likewise kept, not deleted, even though nothing currently reads it
  // — see setOpenPlaySettings' own admin UI for the still-visible field.
  async reconcileNoShows(sessionId: string): Promise<void> {
    const session = await prisma.openPlayNightSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      return;
    }

    const { noShowReleaseMinutes } = await settingsService.getOpenPlaySettings();
    const cutoff = new Date(session.startAt.getTime() + noShowReleaseMinutes * 60_000);
    if (Date.now() < cutoff.getTime()) {
      return;
    }

    const overdue = await prisma.openPlayNightRegistration.findMany({
      where: { sessionId, status: "CONFIRMED", checkedInAt: null },
      select: { id: true },
    });

    for (const registration of overdue) {
      // markNoShow already wraps its own release+promotion in one
      // transaction (BUILD-SPEC.md §6 correctness #5) — sequential here is
      // fine, each no-show is an independent release.
      await openPlayRegistrationService.markNoShow(registration.id, null);
    }
  }

  // BUILD-SPEC.md §6 correctness #1: "Queue position derives from
  // checkedInAt, never registeredAt" — checkedIn is sorted accordingly.
  //
  // Reported live: regular-mode walk-ins on a Fri/Sat date (before the
  // evening cutoff — see isBeforeFridaySaturdayOpenPlayCutoff) never
  // appeared here at all, because the capacity branch filtered strictly
  // by sessionId. Now filters by DATE whenever a session exists — the
  // date-matches-session DB trigger (migration 11) guarantees
  // session.date and the passed date agree, so this is a safe widening,
  // not a guess — it's the union of both registration types for that
  // date, exactly "who do I expect to physically show up and check in
  // today," regardless of which rate they're on. Deliberately NOT
  // applied to the roster/capacity-count panel (getSessionRegistrations,
  // still sessionId-scoped) — a regular-mode registration must never
  // count against the unlimited session's own seat capacity.
  async getCheckInScreenData(where: { sessionId: string; date: Date } | { date: Date }): Promise<CheckInScreenData> {
    if ("sessionId" in where) {
      // reconcileNoShows is deliberately NOT called here anymore — owner
      // decision, see that method's own comment. Seats free by explicit
      // staff action only (the roster's "No-show" button, or the manual
      // release action on Expected rows).
      // Open-play online self-registration, Gate 2 review follow-up:
      // same lazy-on-read pattern as reconcileNoShows immediately above,
      // for a different stale-state class (a lapsed online invite with
      // no cancellation/capacity-change to otherwise trigger it). Weeknight
      // (no sessionId) has no waitlist/invites, so this only runs for
      // Fri/Sat, same guard as reconcileNoShows.
      await openPlayRegistrationService.reconcileExpiredInvites(where.sessionId, null);
    }

    const filter: Prisma.OpenPlayNightRegistrationWhereInput =
      "sessionId" in where ? { date: where.date } : { sessionId: null, date: where.date };

    // waitlistPos: null — a waitlisted walk-in (Fri/Sat) has no real
    // seat and hasn't paid; it must never appear as "expected to arrive"
    // alongside genuinely seated registrations. No-op for weeknight rows
    // (always waitlistPos null, no capacity there), so this is safe to
    // apply to both branches via the same shared query.
    const registrations = await prisma.openPlayNightRegistration.findMany({
      where: { ...filter, status: "CONFIRMED", waitlistPos: null },
      orderBy: { registeredAt: "asc" },
    });

    return {
      expected: registrations.filter((registration) => !registration.checkedInAt),
      checkedIn: registrations
        .filter((registration) => registration.checkedInAt)
        .sort((a, b) => (a.checkedInAt?.getTime() ?? 0) - (b.checkedInAt?.getTime() ?? 0)),
    };
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
      logger.error({ err: error, action: entry.action, userId: entry.actorUserId }, "Failed to write audit log entry");
    }
  }
}

export const openPlayCheckinService = new OpenPlayCheckinService();
