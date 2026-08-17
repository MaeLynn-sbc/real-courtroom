import type {
  RecordScoreInput,
  ScheduleMatchInput,
} from "@/features/tournaments/schemas/tournament.schema";
import type { Match, Prisma, Score, StagedGroupSlot } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { BRONZE_BRACKET_POSITION, pairNextRound } from "@/services/tournaments/bracket-generator";
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

// The team that LOST a decided match. Returns null for a bye (no second
// team) or an undecided match — a bronze match can't be built from either,
// and inventing a placeholder opponent would be worse than not creating it.
function loserTeamId(match: Pick<Match, "team1Id" | "team2Id" | "winnerTeamId">): string | null {
  if (!match.winnerTeamId || !match.team2Id) {
    return null;
  }
  return match.winnerTeamId === match.team1Id ? match.team2Id : match.team1Id;
}

// Shared by tryAdvanceBracket (creating it alongside the final) and
// setThirdPlaceMatch (turning it on after the semis are already done).
// Idempotent: returns null if the slot is taken or either loser is
// unavailable, so a retry or a double-toggle can't duplicate it.
async function createThirdPlaceMatch(
  client: Prisma.TransactionClient,
  args: {
    tournamentCategoryId: string;
    finalRound: number;
    semifinals: Pick<Match, "team1Id" | "team2Id" | "winnerTeamId" | "bracketPosition">[];
  },
): Promise<Match | null> {
  const { tournamentCategoryId, finalRound, semifinals } = args;
  if (semifinals.length !== 2) {
    return null;
  }

  const existing = await client.match.findFirst({
    where: { tournamentCategoryId, round: finalRound, bracketPosition: BRONZE_BRACKET_POSITION },
  });
  if (existing) {
    return null;
  }

  // Ordered by the semifinals' own bracket positions so the bronze match
  // reads "loser of SF1 vs loser of SF2", not whichever finished first.
  const ordered = [...semifinals].sort(
    (a, b) => (a.bracketPosition ?? 0) - (b.bracketPosition ?? 0),
  );
  const [loser1, loser2] = ordered.map(loserTeamId);
  if (!loser1 || !loser2) {
    return null;
  }

  return client.match.create({
    data: {
      tournamentCategoryId,
      round: finalRound,
      bracketPosition: BRONZE_BRACKET_POSITION,
      team1Id: loser1,
      team2Id: loser2,
      status: "SCHEDULED",
    },
  });
}

// Has this match's result already been built on? True once the next-round
// match it feeds exists — at which point its winner is already sitting in
// that match (and, for a semifinal, its loser in the bronze match beside
// the final, which is created in the same transaction).
//
// Same (round + 1, floor(position / 2)) feed rule deleteMatch guards on,
// and the same rule the public bracket inverts to label placeholders.
// Only meaningful for a single-elimination bracket: a round robin advances
// nothing, and a manual match has no bracketPosition at all.
async function hasFedNextRound(
  client: Prisma.TransactionClient,
  match: Pick<Match, "tournamentCategoryId" | "round" | "bracketPosition">,
): Promise<boolean> {
  if (match.tournamentCategoryId === null || match.round === null || match.bracketPosition === null) {
    return false;
  }
  const category = await client.tournamentCategory.findUnique({
    where: { id: match.tournamentCategoryId },
  });
  if (category?.format !== "SINGLE_ELIMINATION") {
    return false;
  }
  const next = await client.match.findFirst({
    where: {
      tournamentCategoryId: match.tournamentCategoryId,
      round: match.round + 1,
      bracketPosition: Math.floor(match.bracketPosition / 2),
    },
  });
  return next !== null;
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
      data: {
        courtId: input.courtId,
        scheduledAt: input.scheduledAt,
        // A real court assignment always supersedes a staging slot —
        // see stageMatch's own comment for the reverse direction.
        //
        // Reported live (2026-08-17): "when u choose and u select to no
        // court it's still on then, next up and all." This used to test
        // `input.courtId` for truthiness, so picking "No court"
        // (courtId: null) fell into the empty spread and left stagedSlot
        // untouched — the match cleared off its court but stayed sitting
        // in Next up / After that / Then on the TV, with no way to get
        // it out. Same family as the earlier "No court" bug (a null that
        // needed handling and got treated as absent), one layer up.
        //
        // The distinction that matters is null vs undefined, NOT truthy
        // vs falsy: an explicit null means "take this match off the
        // board", which has to clear staging too, while undefined means
        // the caller never mentioned the court (e.g. updating only
        // scheduledAt) and staging must be left alone.
        ...(input.courtId !== undefined ? { stagedSlot: null } : {}),
        // Owner request (2026-08-09): the tournament TV (/tourtv) auto-
        // announces the moment a match is assigned a real court — see
        // Match.announcementRequestedAt's own schema comment. Bumped
        // whenever this call carries a courtId (freely re-triggerable,
        // same "no already-announced guard" shape as Open Play's manual
        // Announce button) — a call that only updates scheduledAt
        // without a courtId doesn't re-announce. This is also how the
        // manual "re-announce" button works (owner request, 2026-08-15:
        // "add here announce button, to repeat it incase they did not
        // hear it the first time") — it just calls this same action
        // again with the match's current courtId, no separate endpoint.
        ...(input.courtId ? { announcementRequestedAt: new Date() } : {}),
      },
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

  // Owner request (2026-08-15): "add also in the dropdown the next up
  // after that and then. then we will just manually transfer them to
  // court numbers. no voice announcements for next up after that and
  // then" — a pure scheduling holding-pen, no court, no announcement.
  // Clears any existing court assignment (staging supersedes it, same
  // as scheduleMatch clearing stagedSlot the other direction) — a
  // match is either staged or on a real court, never both at once.
  async stageMatch(matchId: string, slot: StagedGroupSlot, actorUserId: string): Promise<Match> {
    const match = await prisma.match.update({
      where: { id: matchId },
      data: { stagedSlot: slot, courtId: null, scheduledAt: null },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.match_staged",
      entityType: "Match",
      entityId: match.id,
      newValues: { stagedSlot: match.stagedSlot },
    });

    return match;
  }

  async recordScore(matchId: string, input: RecordScoreInput, actorUserId: string): Promise<Score> {
    const existingMatch = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });

    // Owner request (2026-08-17): "also add edit in the scorecards" — a
    // finished match's score could not be corrected at all. Unlocking the
    // inputs alone would have been worse than leaving it locked:
    // winnerTeamId is frozen by completeMatch and never recomputed, so a
    // corrected score would have sat under the OLD winner, on the public
    // bracket, indefinitely. Correcting a decided match is therefore its
    // own guarded path.
    if (existingMatch.status === "COMPLETED") {
      return this.correctScoreOnCompletedMatch(existingMatch, input, actorUserId);
    }

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

  // Correcting the score of an already-COMPLETED match, with the winner
  // recomputed from the corrected scores.
  //
  // A correction that leaves the same team winning is always allowed —
  // fixing "11-9" to "11-8" is the ordinary case and mustn't be blocked.
  // A correction that FLIPS the winner is only allowed while nothing has
  // been built on top of that result: once the next round exists, the
  // winner is already sitting in it (and, for a semifinal, the loser is
  // sitting in the bronze match), so silently flipping it here would leave
  // the wrong team in a match that has possibly already been played. That
  // case is refused and pointed at reset-bracket, the same reasoning
  // deleteMatch's own guard uses.
  //
  // The whole thing runs in one transaction, and the refusal happens AFTER
  // the upsert but inside it — so a rejected correction rolls the score
  // back out rather than persisting a score whose winner was never applied.
  private async correctScoreOnCompletedMatch(
    match: Match,
    input: RecordScoreInput,
    actorUserId: string,
  ): Promise<Score> {
    const { score, previousWinnerTeamId, newWinnerTeamId } = await prisma.$transaction(
      async (tx) => {
        const upserted = await tx.score.upsert({
          where: { matchId_setNumber: { matchId: match.id, setNumber: input.setNumber } },
          update: { team1Score: input.team1Score, team2Score: input.team2Score },
          create: {
            matchId: match.id,
            setNumber: input.setNumber,
            team1Score: input.team1Score,
            team2Score: input.team2Score,
          },
        });

        const scores = await tx.score.findMany({ where: { matchId: match.id } });
        const recomputed = determineMatchWinner(scores, match.team1Id, match.team2Id);
        if (!recomputed) {
          throw new Error(
            "That correction leaves the match without a decisive result — adjust the scores so one side clearly wins.",
          );
        }

        if (recomputed !== match.winnerTeamId) {
          if (await hasFedNextRound(tx, match)) {
            throw new Error(
              "This correction would change who won, but the next round has already been created from this result. Reset the bracket if the result really needs to change.",
            );
          }
          await tx.match.update({ where: { id: match.id }, data: { winnerTeamId: recomputed } });
        }

        return {
          score: upserted,
          previousWinnerTeamId: match.winnerTeamId,
          newWinnerTeamId: recomputed,
        };
      },
    );

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.completed_match_score_corrected",
      entityType: "Match",
      entityId: match.id,
      oldValues: { winnerTeamId: previousWinnerTeamId },
      newValues: {
        setNumber: input.setNumber,
        team1Score: input.team1Score,
        team2Score: input.team2Score,
        winnerTeamId: newWinnerTeamId,
      },
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

  // Owner request (2026-08-15), LIVE during the tournament: "manual
  // match ups and auto match ups. kindly make a button or option to
  // delete" — one delete path for both: a manually-created match
  // (createManualMatch, tournament.service.ts) never has a
  // bracketPosition and is fully isolated from bracket advancement, so
  // it's always safe to remove outright. An auto-generated
  // SINGLE_ELIMINATION match DOES have a bracketPosition and could have
  // already fed tryAdvanceBracket's next-round creation — deleting it
  // at that point would leave the next round's match referencing a
  // slot whose source row no longer exists, silently stalling that
  // whole branch of the bracket the next time its sibling completes.
  // Refuses only that specific unsafe case; every other match (any
  // Round Robin match, any not-yet-advanced Single Elimination match,
  // any manual match regardless of status) deletes cleanly. Scores
  // cascade-delete automatically (Score.match has onDelete: Cascade,
  // see prisma/schema.prisma).
  async deleteMatch(matchId: string, actorUserId: string): Promise<void> {
    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });

    if (match.tournamentCategoryId && match.round !== null && match.bracketPosition !== null) {
      const category = await prisma.tournamentCategory.findUnique({
        where: { id: match.tournamentCategoryId },
      });
      if (category?.format === "SINGLE_ELIMINATION") {
        const nextMatch = await prisma.match.findFirst({
          where: {
            tournamentCategoryId: match.tournamentCategoryId,
            round: match.round + 1,
            bracketPosition: Math.floor(match.bracketPosition / 2),
          },
        });
        if (nextMatch) {
          throw new Error(
            "Cannot delete this match — it has already advanced to the next round. Reset the bracket instead if you need to redo it.",
          );
        }
      }
    }

    await prisma.match.delete({ where: { id: matchId } });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.match_deleted",
      entityType: "Match",
      entityId: matchId,
      oldValues: {
        team1Id: match.team1Id,
        team2Id: match.team2Id,
        round: match.round,
        bracketPosition: match.bracketPosition,
        status: match.status,
      },
    });
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
  // Owner-facing toggle. Turning it ON after the semifinals are already
  // decided creates the bronze match retroactively rather than silently
  // doing nothing — that's the common case here, since the decision to
  // play for third often gets made once the semis are over.
  //
  // Turning it OFF removes the match only while it's untouched. Once it
  // has a score or a result it's real history, and deleting it would erase
  // a played game; that case is refused with a clear message instead.
  async setThirdPlaceMatch(
    categoryId: string,
    enabled: boolean,
    actorUserId: string,
  ): Promise<void> {
    const category = await prisma.tournamentCategory.findUniqueOrThrow({
      where: { id: categoryId },
    });
    if (category.format !== "SINGLE_ELIMINATION") {
      throw new Error("A third-place match only applies to a single-elimination bracket.");
    }

    const bracketMatches = await prisma.match.findMany({
      where: { tournamentCategoryId: categoryId, round: { not: null }, bracketPosition: { not: null } },
    });
    const finalRound = bracketMatches.length
      ? Math.max(...bracketMatches.map((m) => m.round as number))
      : null;
    const existingBronze =
      finalRound === null
        ? null
        : (bracketMatches.find(
            (m) => m.round === finalRound && m.bracketPosition === BRONZE_BRACKET_POSITION,
          ) ?? null);

    if (!enabled && existingBronze) {
      if (existingBronze.status !== "SCHEDULED" || existingBronze.winnerTeamId) {
        throw new Error(
          "This third-place match has already been played — it can't be removed. Delete it from the match list if that's really what you want.",
        );
      }
      await prisma.match.delete({ where: { id: existingBronze.id } });
    }

    await prisma.tournamentCategory.update({
      where: { id: categoryId },
      data: { hasThirdPlaceMatch: enabled },
    });

    // Retroactive creation: the semifinals are the round that feeds the
    // final, i.e. finalRound - 1, and there must be exactly two of them.
    if (enabled && !existingBronze && finalRound !== null) {
      const semifinals = bracketMatches.filter((m) => m.round === finalRound - 1);
      if (semifinals.length === 2) {
        const created = await prisma.$transaction((tx) =>
          createThirdPlaceMatch(tx, {
            tournamentCategoryId: categoryId,
            finalRound,
            semifinals,
          }),
        );
        if (created) {
          await this.writeAuditLog({
            actorUserId,
            action: "tournament.third_place_match_created",
            entityType: "Match",
            entityId: created.id,
            newValues: { round: created.round, bracketPosition: created.bracketPosition },
          });
        }
      }
    }

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.third_place_match_setting_changed",
      entityType: "TournamentCategory",
      entityId: categoryId,
      oldValues: { hasThirdPlaceMatch: category.hasThirdPlaceMatch },
      newValues: { hasThirdPlaceMatch: enabled },
    });
  }

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

          const created = await tx.match.create({
            data: {
              tournamentCategoryId,
              round: nextRound,
              bracketPosition: nextPosition,
              team1Id: pairing.team1Id,
              team2Id: pairing.team2Id,
              status: "SCHEDULED",
            },
          });

          // Third-place playoff (owner request 2026-08-17). Created in
          // the SAME transaction as the final, from the two matches that
          // just produced it — i.e. the semifinal LOSERS, which nothing
          // else in this service ever looks at.
          //
          // "Is this the semifinal round?" is answered by counting: the
          // round that feeds a single next match is the semifinal, so
          // exactly 2 matches in `round` means nextRound is the final.
          // That holds for any draw size without hardcoding round numbers.
          //
          // Sits at the final's own round, bracketPosition 1 (final is 0),
          // so it needs no new columns and can't collide. Deliberately
          // outside advancement: tryAdvanceBracket looks for a sibling at
          // position 0/1 of a round it is advancing FROM, and nothing ever
          // advances out of the final round, so this row is inert there.
          if (category.hasThirdPlaceMatch) {
            const roundMatchCount = await tx.match.count({
              where: { tournamentCategoryId, round },
            });
            if (roundMatchCount === 2) {
              await createThirdPlaceMatch(tx, {
                tournamentCategoryId,
                finalRound: nextRound,
                semifinals: [match, sibling],
              });
            }
          }

          return created;
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
