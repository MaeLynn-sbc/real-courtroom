import type { Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { nextSequence } from "@/lib/reference-counter";
import { courtAssignmentService } from "@/services/open-play/court-assignment.service";
import { queueService } from "@/services/open-play/queue.service";

// Fixed constant, not a per-session field — AI court balancing is out of
// scope, so grouping is simply "next N in the Waiting queue," doubles.
const MATCH_GROUP_SIZE = 4;

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

interface AuditLogEntry {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

export type StartNextMatchResult =
  | { started: true; matchId: string; courtId: string }
  | { started: false; reason: "NOT_ENOUGH_PLAYERS" | "NO_COURT_AVAILABLE" };

export interface OpenPlayQueueStats {
  waitingCount: number;
  playingCount: number;
  restingCount: number;
  waitlistCount: number;
  availableCourts: number;
  activeMatches: number;
}

// Top-level orchestrator for the live Waiting/Playing/Resting rotation.
// Owns OpenPlayMatch/OpenPlayMatchParticipant writes (match history) and
// delegates all OpenPlayQueue state changes to queue.service.ts, which is
// the sole owner of that table and its history log.
export class RotationEngine {
  // Phase 10: the available-court check and the match create now run
  // inside one Serializable transaction — previously two near-simultaneous
  // "start next match" calls could both see the same court as available
  // and both create a match on it before either write landed.
  async startNextMatch(sessionId: string, actorUserId: string): Promise<StartNextMatchResult> {
    const waitingGroup = await prisma.openPlayQueue.findMany({
      where: { openPlaySessionId: sessionId, status: "WAITING" },
      orderBy: { queuePosition: "asc" },
      take: MATCH_GROUP_SIZE,
    });

    if (waitingGroup.length < MATCH_GROUP_SIZE) {
      return { started: false, reason: "NOT_ENOUGH_PLAYERS" };
    }

    const outcome = await prisma.$transaction(
      async (tx) => {
        const court = await courtAssignmentService.findAvailableCourt(tx);
        if (!court) {
          return { court: null };
        }

        // v1.1 maintenance: was a raw count-then-add-one (fragile the same
        // way every other reference generator in this app used to be — a
        // deleted OpenPlayMatch row would desync it) — now the shared
        // atomic counter (lib/reference-counter.ts), scoped per session.
        const matchNumber = await nextSequence(`OPEN_PLAY_MATCH:${sessionId}`, tx);

        const match = await tx.openPlayMatch.create({
          data: {
            openPlaySessionId: sessionId,
            courtId: court.id,
            matchNumber,
            participants: {
              create: waitingGroup.map((entry) => ({ registrationId: entry.registrationId })),
            },
          },
        });

        return { court, match, matchNumber };
      },
      { isolationLevel: "Serializable" },
    );

    if (!outcome.court) {
      return { started: false, reason: "NO_COURT_AVAILABLE" };
    }

    const { court, match, matchNumber } = outcome;

    for (const entry of waitingGroup) {
      await queueService.setPlaying(entry.id, court.id);
    }

    await this.writeAuditLog({
      actorUserId,
      action: "open_play.match_started",
      entityType: "OpenPlayMatch",
      entityId: match.id,
      newValues: {
        openPlaySessionId: sessionId,
        courtId: court.id,
        matchNumber,
        registrationIds: waitingGroup.map((entry) => entry.registrationId),
      },
    });

    return { started: true, matchId: match.id, courtId: court.id };
  }

  async endMatch(courtId: string, actorUserId: string): Promise<void> {
    const playingEntries = await prisma.openPlayQueue.findMany({
      where: { courtId, status: "PLAYING" },
    });

    if (playingEntries.length === 0) {
      throw new Error("No active match on this court.");
    }

    const openMatch = await prisma.openPlayMatch.findFirst({
      where: { courtId, endedAt: null },
      orderBy: { startedAt: "desc" },
    });

    for (const entry of playingEntries) {
      await queueService.setResting(entry.id);
    }

    if (openMatch) {
      await prisma.openPlayMatch.update({
        where: { id: openMatch.id },
        data: { endedAt: new Date(), completedByUserId: actorUserId },
      });

      await this.writeAuditLog({
        actorUserId,
        action: "open_play.match_ended",
        entityType: "OpenPlayMatch",
        entityId: openMatch.id,
      });
    }
  }

  async returnFromRest(queueId: string, actorUserId: string) {
    const queueEntry = await queueService.setWaiting(queueId);

    await this.writeAuditLog({
      actorUserId,
      action: "open_play.queue_returned_to_waiting",
      entityType: "OpenPlayQueue",
      entityId: queueEntry.id,
    });

    return queueEntry;
  }

  async getRotationView(sessionId: string) {
    const queue = await queueService.getQueue(sessionId);

    return {
      waiting: queue.filter((entry) => entry.status === "WAITING"),
      playing: queue.filter((entry) => entry.status === "PLAYING"),
      resting: queue.filter((entry) => entry.status === "RESTING"),
    };
  }

  async getQueueStats(sessionId: string): Promise<OpenPlayQueueStats> {
    const [queue, waitlistCount, availableCourts, activeMatches] = await Promise.all([
      queueService.getQueue(sessionId),
      prisma.openPlayRegistration.count({
        where: { openPlaySessionId: sessionId, status: "WAITLISTED" },
      }),
      courtAssignmentService.countAvailableCourts(),
      prisma.openPlayMatch.count({ where: { openPlaySessionId: sessionId, endedAt: null } }),
    ]);

    return {
      waitingCount: queue.filter((entry) => entry.status === "WAITING").length,
      playingCount: queue.filter((entry) => entry.status === "PLAYING").length,
      restingCount: queue.filter((entry) => entry.status === "RESTING").length,
      waitlistCount,
      availableCourts,
      activeMatches,
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
      logger.error(
        { err: error, action: entry.action, userId: entry.actorUserId },
        "Failed to write audit log entry",
      );
    }
  }
}

export const rotationEngine = new RotationEngine();
