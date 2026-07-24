import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type {
  OpenPlayNightRegistration,
  OpenPlayNightRegistrationSource,
  Prisma,
} from "@/lib/generated/prisma/client";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";
import { OPEN_PLAY_SKILL_LEVEL_ORDER } from "@/types/open-play-skill-levels";

// BUILD-SPEC.md §5. Concurrency: SELECT ... FOR UPDATE on the session
// row (the spec's first-named technique, not the Serializable-isolation-
// plus-retry pattern booking.service.ts uses for the equivalent
// double-booking problem) — every concurrent registration or release
// against the same session serializes through the row lock and blocks in
// order rather than racing to commit and retrying on conflict. Simpler to
// reason about under real contention: no retry storm, no P2034 handling
// needed, transactions just queue.

interface AuditLogEntry {
  // null = system-driven (e.g. no-show auto-release), no human actor —
  // same precedent as membershipService.reconcileExpiredMemberships'
  // changedById: null, not a resolved "system user" identity.
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

export interface RegisterWalkInInput {
  playerName: string;
  phone: string;
  skillLevel: OpenPlaySkillLevel;
  playerId?: string;
  partyId?: string;
}

export type ReleaseStatus = "CANCELLED" | "NO_SHOW" | "CHECKED_OUT";

export interface SessionRegistrations {
  registrations: OpenPlayNightRegistration[];
  skillBreakdown: Record<OpenPlaySkillLevel, number>;
}

async function lockSessionRow(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<{ id: string; date: Date; capacity: number } | null> {
  const rows = await tx.$queryRaw<{ id: string; date: Date; capacity: number }[]>`
    SELECT id, date, capacity FROM "OpenPlayNightSession" WHERE id = ${sessionId} FOR UPDATE
  `;
  return rows[0] ?? null;
}

export class OpenPlayRegistrationService {
  // Phase 4 only builds the staff walk-in path (cash, paid immediately —
  // see the OpenPlayNightRegistrationStatus enum comment in schema.prisma)
  // — status always lands on CONFIRMED; waitlistPos non-null means "paid,
  // no seat yet" rather than a separate status value.
  async registerWalkIn(sessionId: string, input: RegisterWalkInInput, actorUserId: string): Promise<OpenPlayNightRegistration> {
    const registration = await prisma.$transaction(async (tx) => {
      const session = await lockSessionRow(tx, sessionId);
      if (!session) {
        throw new Error("Open play night session not found.");
      }

      // "Confirmed" for capacity-counting purposes = has a seat: status
      // CONFIRMED and no waitlistPos (BUILD-SPEC.md §5 "Only confirmed
      // (verified paid) registrations count toward capacity").
      const seatedCount = await tx.openPlayNightRegistration.count({
        where: { sessionId, status: "CONFIRMED", waitlistPos: null },
      });

      let waitlistPos: number | null = null;
      if (seatedCount >= session.capacity) {
        const { _max } = await tx.openPlayNightRegistration.aggregate({
          where: { sessionId, waitlistPos: { not: null } },
          _max: { waitlistPos: true },
        });
        waitlistPos = (_max.waitlistPos ?? 0) + 1;
      }

      return tx.openPlayNightRegistration.create({
        data: {
          sessionId,
          date: session.date,
          playerId: input.playerId,
          playerName: input.playerName,
          phone: input.phone,
          skillLevel: input.skillLevel,
          partyId: input.partyId,
          source: "WALK_IN" satisfies OpenPlayNightRegistrationSource,
          status: "CONFIRMED",
          waitlistPos,
        },
      });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_registration.created",
      entityType: "OpenPlayNightRegistration",
      entityId: registration.id,
      newValues: { sessionId, waitlistPos: registration.waitlistPos, skillLevel: registration.skillLevel },
    });

    return registration;
  }

  // BUILD-SPEC.md §0 — weeknight open play has no capacity, no waitlist,
  // no prepayment, so no lock, no capacity check, no waitlistPos, ever.
  // `date` is the sole grouping key (no session to hang off of).
  async registerWeeknightWalkIn(
    date: Date,
    input: RegisterWalkInInput,
    actorUserId: string,
  ): Promise<OpenPlayNightRegistration> {
    const registration = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: null,
        date,
        playerId: input.playerId,
        playerName: input.playerName,
        phone: input.phone,
        skillLevel: input.skillLevel,
        partyId: input.partyId,
        source: "WALK_IN" satisfies OpenPlayNightRegistrationSource,
        status: "CONFIRMED",
        waitlistPos: null,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_registration.created",
      entityType: "OpenPlayNightRegistration",
      entityId: registration.id,
      newValues: { date, skillLevel: registration.skillLevel },
    });

    return registration;
  }

  async cancelRegistration(registrationId: string, actorUserId: string): Promise<OpenPlayNightRegistration> {
    return this.releaseRegistration(registrationId, "CANCELLED", actorUserId);
  }

  // actorUserId is nullable here specifically for reconcileNoShows'
  // system-driven auto-release (BUILD-SPEC.md §6 "No-shows") — every
  // staff-initiated call site still passes a real user id.
  async markNoShow(registrationId: string, actorUserId: string | null): Promise<OpenPlayNightRegistration> {
    return this.releaseRegistration(registrationId, "NO_SHOW", actorUserId);
  }

  async markCheckedOut(registrationId: string, actorUserId: string): Promise<OpenPlayNightRegistration> {
    return this.releaseRegistration(registrationId, "CHECKED_OUT", actorUserId);
  }

  // BUILD-SPEC.md §5 "Auto-promotion... inside the same transaction as
  // the status change, so a freed slot is never lost or double-assigned."
  // Locks the session row too (not just the registration being released)
  // so a concurrent registerWalkIn can't read a stale seated count while
  // a release+promotion is in flight.
  private async releaseRegistration(
    registrationId: string,
    status: ReleaseStatus,
    actorUserId: string | null,
  ): Promise<OpenPlayNightRegistration> {
    const released = await prisma.$transaction(async (tx) => {
      const existing = await tx.openPlayNightRegistration.findUniqueOrThrow({ where: { id: registrationId } });

      // Weeknight (sessionId null) has no capacity/waitlist at all — just
      // flip the status, nothing to lock or promote.
      if (!existing.sessionId) {
        return tx.openPlayNightRegistration.update({
          where: { id: registrationId },
          data: {
            status,
            checkedOutAt: status === "CHECKED_OUT" ? new Date() : existing.checkedOutAt,
          },
        });
      }

      await lockSessionRow(tx, existing.sessionId);

      // Hardening phase fix (BUILD-SPEC.md §0 process rule): releasedHadSeat
      // / releasedWaitlistPos used to be computed from `existing`, read
      // BEFORE the session lock above. Two concurrent releases of the SAME
      // registration (a cancel button double-tapped, or a cancel racing an
      // auto no-show) both read the row as CONFIRMED before either had
      // acquired the lock — the lock only serializes their commits, it
      // doesn't retroactively invalidate what each had already decided to
      // do. Whichever one actually runs second still "frees a seat" from
      // data that's stale by the time it runs, and promotes a second
      // waitlist entry for a seat that was already given away once — one
      // real freed seat, two promotions. Re-reading the registration's own
      // row fresh, AFTER the session lock is held (so nothing else can
      // interleave), closes the gap: the second transaction sees the
      // first one's already-committed status and knows there's nothing
      // left to release.
      const current = await tx.openPlayNightRegistration.findUniqueOrThrow({ where: { id: registrationId } });
      if (current.status !== "CONFIRMED") {
        // Already released by a concurrent (or earlier) call — idempotent
        // no-op, same treatment as check-in's double-tap.
        return current;
      }

      const releasedHadSeat = current.waitlistPos === null;
      const releasedWaitlistPos = current.waitlistPos;

      const updated = await tx.openPlayNightRegistration.update({
        where: { id: registrationId },
        data: {
          status,
          checkedOutAt: status === "CHECKED_OUT" ? new Date() : current.checkedOutAt,
        },
      });

      if (releasedHadSeat) {
        const head = await tx.openPlayNightRegistration.findFirst({
          where: { sessionId: existing.sessionId, waitlistPos: { not: null } },
          orderBy: { waitlistPos: "asc" },
        });
        if (head) {
          await tx.openPlayNightRegistration.update({
            where: { id: head.id },
            data: { waitlistPos: null },
          });
          await tx.openPlayNightRegistration.updateMany({
            where: { sessionId: existing.sessionId, waitlistPos: { gt: head.waitlistPos ?? 0 } },
            data: { waitlistPos: { decrement: 1 } },
          });
        }
      } else if (releasedWaitlistPos !== null) {
        // Released registration was itself waitlisted, not seated — no
        // promotion, just close the gap behind it.
        await tx.openPlayNightRegistration.updateMany({
          where: { sessionId: existing.sessionId, waitlistPos: { gt: releasedWaitlistPos } },
          data: { waitlistPos: { decrement: 1 } },
        });
      }

      return updated;
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_registration.released",
      entityType: "OpenPlayNightRegistration",
      entityId: released.id,
      newValues: { status },
    });

    return released;
  }

  async getSessionRegistrations(sessionId: string): Promise<SessionRegistrations> {
    const registrations = await prisma.openPlayNightRegistration.findMany({
      where: { sessionId },
      orderBy: [{ waitlistPos: "asc" }, { registeredAt: "asc" }],
    });

    const skillBreakdown = Object.fromEntries(
      OPEN_PLAY_SKILL_LEVEL_ORDER.map((level) => [level, 0]),
    ) as Record<OpenPlaySkillLevel, number>;
    for (const registration of registrations) {
      if (registration.status === "CONFIRMED") {
        skillBreakdown[registration.skillLevel] += 1;
      }
    }

    return { registrations, skillBreakdown };
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

export const openPlayRegistrationService = new OpenPlayRegistrationService();
