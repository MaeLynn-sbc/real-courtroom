import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { OpenPlayNightRegistration, Prisma, QueueEntry } from "@/lib/generated/prisma/client";
import type { RaceHook } from "@/lib/race-test-hooks";
import { openPlayRegistrationService, type RegisterWalkInInput } from "@/services/open-play/open-play-registration.service";
import { playerTabService } from "@/services/open-play/player-tab.service";
import { settingsService } from "@/services/settings/settings.service";

// BUILD-SPEC.md §6 "Registration and check-in" — check-in is what enters
// a player into the queue, not registration. Everything here operates on
// OpenPlayNightRegistration rows Phase 4 already produces (always
// CONFIRMED, cash-walk-in) — no payment-status gating exists yet.

const UNDO_WINDOW_MS = 60_000;

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
  async registerAndCheckIn(
    target: { sessionId: string } | { date: Date },
    input: RegisterWalkInInput,
    actorUserId: string,
  ): Promise<CheckInResult> {
    const registration =
      "sessionId" in target
        ? await openPlayRegistrationService.registerWalkIn(target.sessionId, input, actorUserId)
        : await openPlayRegistrationService.registerWeeknightWalkIn(target.date, input, actorUserId);

    return this.checkIn(registration.id, actorUserId);
  }

  // Lazy reconciliation, not a cron job (this codebase's established
  // pattern — see membershipService.reconcileExpiredMemberships) — called
  // at the top of the check-in screen's/roster's read path, not on a
  // schedule. Fri/Sat only (weeknight has no capacity to protect).
  // actorUserId is null on the audit trail: no human triggered this,
  // same precedent as membership expiry's changedById: null.
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
  async getCheckInScreenData(where: { sessionId: string } | { date: Date }): Promise<CheckInScreenData> {
    if ("sessionId" in where) {
      await this.reconcileNoShows(where.sessionId);
    }

    const filter: Prisma.OpenPlayNightRegistrationWhereInput =
      "sessionId" in where ? { sessionId: where.sessionId } : { sessionId: null, date: where.date };

    const registrations = await prisma.openPlayNightRegistration.findMany({
      where: { ...filter, status: "CONFIRMED" },
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
