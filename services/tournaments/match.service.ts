import type {
  RecordScoreInput,
  ScheduleMatchInput,
} from "@/features/tournaments/schemas/tournament.schema";
import type { Match, Prisma, Score } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { pairNextRound } from "@/services/tournaments/bracket-generator";
import { canTransitionMatchStatus, determineMatchWinner } from "@/services/tournaments/match-status";

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

// Phase 10: see booking.service.ts's identical helper for why P2034 is
// treated the same way as a unique-constraint hit below.
function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2034"
  );
}

interface AuditLogEntry {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

const teamInclude = {
  team1: {
    include: {
      player1: { include: { user: { select: { id: true, name: true, email: true } } } },
      player2: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  },
  team2: {
    include: {
      player1: { include: { user: { select: { id: true, name: true, email: true } } } },
      player2: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  },
} satisfies Prisma.MatchInclude;

export class MatchService {
  async listMatchesByCategory(categoryId: string) {
    return prisma.match.findMany({
      where: { tournamentCategoryId: categoryId },
      include: { ...teamInclude, court: true, scores: { orderBy: { setNumber: "asc" } } },
      orderBy: [{ round: "asc" }, { bracketPosition: "asc" }, { createdAt: "asc" }],
    });
  }

  async getMatchById(matchId: string) {
    return prisma.match.findUnique({
      where: { id: matchId },
      include: { ...teamInclude, court: true, scores: { orderBy: { setNumber: "asc" } } },
    });
  }

  async scheduleMatch(matchId: string, input: ScheduleMatchInput, actorUserId: string): Promise<Match> {
    const match = await prisma.match.update({
      where: { id: matchId },
      data: { courtId: input.courtId, scheduledAt: input.scheduledAt },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.match_scheduled",
      entityType: "Match",
      entityId: match.id,
      newValues: { courtId: match.courtId, scheduledAt: match.scheduledAt },
    });

    return match;
  }

  async recordScore(matchId: string, input: RecordScoreInput, actorUserId: string): Promise<Score> {
    const existingMatch = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });

    if (existingMatch.status === "SCHEDULED") {
      await prisma.match.update({
        where: { id: matchId },
        data: { status: "IN_PROGRESS", startedAt: existingMatch.startedAt ?? new Date() },
      });
    }

    const score = await prisma.score.upsert({
      where: { matchId_setNumber: { matchId, setNumber: input.setNumber } },
      update: { team1Score: input.team1Score, team2Score: input.team2Score },
      create: {
        matchId,
        setNumber: input.setNumber,
        team1Score: input.team1Score,
        team2Score: input.team2Score,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.score_recorded",
      entityType: "Score",
      entityId: score.id,
      newValues: score,
    });

    return score;
  }

  async completeMatch(matchId: string, actorUserId: string): Promise<Match> {
    const existing = await prisma.match.findUniqueOrThrow({
      where: { id: matchId },
      include: { scores: true },
    });

    if (!canTransitionMatchStatus(existing.status, "COMPLETED")) {
      throw new Error(`Cannot complete a match that is currently ${existing.status}.`);
    }

    const winnerTeamId = determineMatchWinner(existing.scores, existing.team1Id, existing.team2Id);
    if (!winnerTeamId) {
      throw new Error("Enter a decisive set score before completing this match.");
    }

    const match = await prisma.match.update({
      where: { id: matchId },
      data: { status: "COMPLETED", winnerTeamId, completedAt: new Date() },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.match_completed",
      entityType: "Match",
      entityId: match.id,
      newValues: { status: match.status, winnerTeamId: match.winnerTeamId },
    });

    await this.tryAdvanceBracket(match, actorUserId);

    return match;
  }

  async markWalkover(matchId: string, winnerTeamId: string, actorUserId: string): Promise<Match> {
    const existing = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });

    if (!canTransitionMatchStatus(existing.status, "WALKOVER")) {
      throw new Error(`Cannot mark a walkover for a match that is currently ${existing.status}.`);
    }

    if (winnerTeamId !== existing.team1Id && winnerTeamId !== existing.team2Id) {
      throw new Error("The walkover winner must be one of the two teams in this match.");
    }

    const match = await prisma.match.update({
      where: { id: matchId },
      data: { status: "WALKOVER", winnerTeamId, completedAt: new Date() },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.match_walkover",
      entityType: "Match",
      entityId: match.id,
      newValues: { status: match.status, winnerTeamId: match.winnerTeamId },
    });

    await this.tryAdvanceBracket(match, actorUserId);

    return match;
  }

  // Single Elimination only — Round Robin matches have no bracketPosition
  // and nothing to advance into. Progresses one pair at a time: as soon as
  // both matches feeding a bracket slot are decided, creates the next
  // round's match for that pair. Idempotent (checks the next match doesn't
  // already exist) so completing either sibling first is safe.
  // Phase 10: the sibling/alreadyCreated checks and the next-round create
  // now run inside one Serializable transaction, backstopped by a
  // @@unique([tournamentCategoryId, round, bracketPosition]) DB constraint
  // on Match (see ARCHITECTURE.md's Phase 10 addendum) — previously two
  // concurrent completions of both sibling matches could each pass the
  // alreadyCreated check before either insert landed, creating the same
  // next-round slot twice. A conflict from either guard is swallowed here
  // (not rethrown) since this is an idempotent side effect: if another
  // concurrent call already created the slot, there's nothing to do.
  private async tryAdvanceBracket(match: Match, actorUserId: string): Promise<void> {
    if (match.tournamentCategoryId === null || match.round === null || match.bracketPosition === null) {
      return;
    }
    if (!match.winnerTeamId) {
      return;
    }

    const category = await prisma.tournamentCategory.findUnique({
      where: { id: match.tournamentCategoryId },
    });
    if (!category || category.format !== "SINGLE_ELIMINATION") {
      return;
    }

    const tournamentCategoryId = match.tournamentCategoryId;
    const round = match.round;
    const bracketPosition = match.bracketPosition;
    const winnerTeamId = match.winnerTeamId;
    const siblingPosition = bracketPosition % 2 === 0 ? bracketPosition + 1 : bracketPosition - 1;
    const nextRound = round + 1;
    const nextPosition = Math.floor(bracketPosition / 2);

    try {
      const nextMatch = await prisma.$transaction(
        async (tx) => {
          const sibling = await tx.match.findFirst({
            where: { tournamentCategoryId, round, bracketPosition: siblingPosition },
          });

          if (!sibling || !sibling.winnerTeamId) {
            // No sibling means this was the final match; sibling not yet
            // decided means the pair isn't ready to advance yet.
            return null;
          }

          const alreadyCreated = await tx.match.findFirst({
            where: { tournamentCategoryId, round: nextRound, bracketPosition: nextPosition },
          });
          if (alreadyCreated) {
            return null;
          }

          const [firstWinnerTeamId, secondWinnerTeamId] =
            bracketPosition < siblingPosition
              ? [winnerTeamId, sibling.winnerTeamId]
              : [sibling.winnerTeamId, winnerTeamId];

          const [pairing] = pairNextRound([firstWinnerTeamId, secondWinnerTeamId]);
          if (!pairing) {
            return null;
          }

          return tx.match.create({
            data: {
              tournamentCategoryId,
              round: nextRound,
              bracketPosition: nextPosition,
              team1Id: pairing.team1Id,
              team2Id: pairing.team2Id,
              status: "SCHEDULED",
            },
          });
        },
        { isolationLevel: "Serializable" },
      );

      if (nextMatch) {
        await this.writeAuditLog({
          actorUserId,
          action: "tournament.round_created",
          entityType: "Match",
          entityId: nextMatch.id,
          newValues: { round: nextRound, bracketPosition: nextPosition },
        });
      }
    } catch (error) {
      if (isUniqueConstraintViolation(error) || isSerializationFailure(error)) {
        return;
      }
      throw error;
    }
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

export const matchService = new MatchService();
