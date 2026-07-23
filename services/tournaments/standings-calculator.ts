import type { MatchStatus } from "@/lib/generated/prisma/enums";

// Pure aggregation over already-fetched match/score data — no Prisma
// import, unit-tested directly. standings.service.ts does the DB fetch
// and hands the raw rows to these functions.

export interface StandingsMatchInput {
  round: number;
  team1Id: string;
  team2Id: string | null;
  winnerTeamId: string | null;
  status: MatchStatus;
  scores: { team1Score: number; team2Score: number }[];
}

export interface RoundRobinStandingRow {
  teamId: string;
  played: number;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  setDifferential: number;
}

// Sorted by wins desc, then set differential desc, then teamId for a
// stable tiebreak (no head-to-head/strength-of-schedule tiebreaking —
// not requested for this phase).
export function calculateRoundRobinStandings(
  teamIds: string[],
  matches: StandingsMatchInput[],
): RoundRobinStandingRow[] {
  const rows = new Map<string, RoundRobinStandingRow>(
    teamIds.map((teamId) => [
      teamId,
      { teamId, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, setDifferential: 0 },
    ]),
  );

  for (const match of matches) {
    if (match.status !== "COMPLETED" && match.status !== "WALKOVER") {
      continue;
    }
    if (!match.team2Id || !match.winnerTeamId) {
      continue;
    }

    const row1 = rows.get(match.team1Id);
    const row2 = rows.get(match.team2Id);
    if (!row1 || !row2) {
      continue;
    }

    row1.played += 1;
    row2.played += 1;

    let setsWon1 = 0;
    let setsWon2 = 0;
    for (const score of match.scores) {
      if (score.team1Score > score.team2Score) {
        setsWon1 += 1;
      } else if (score.team2Score > score.team1Score) {
        setsWon2 += 1;
      }
    }
    row1.setsWon += setsWon1;
    row1.setsLost += setsWon2;
    row2.setsWon += setsWon2;
    row2.setsLost += setsWon1;

    if (match.winnerTeamId === match.team1Id) {
      row1.wins += 1;
      row2.losses += 1;
    } else {
      row2.wins += 1;
      row1.losses += 1;
    }
  }

  for (const row of rows.values()) {
    row.setDifferential = row.setsWon - row.setsLost;
  }

  return Array.from(rows.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.setDifferential !== a.setDifferential) return b.setDifferential - a.setDifferential;
    return a.teamId.localeCompare(b.teamId);
  });
}

export type EliminationTeamStatus = "CHAMPION" | "ACTIVE" | "ELIMINATED";

export interface EliminationStandingRow {
  teamId: string;
  status: EliminationTeamStatus;
  eliminatedInRound: number | null;
}

// Bracket position already *is* the standing for Single Elimination — this
// walks each team's most recent match (a bye counts, so an un-played
// advance still reads as "active," not eliminated) to derive champion /
// active / eliminated-in-round-N.
export function calculateEliminationStandings(
  teamIds: string[],
  matches: StandingsMatchInput[],
): EliminationStandingRow[] {
  const lastMatchForTeam = new Map<string, StandingsMatchInput>();

  for (const match of matches) {
    for (const teamId of [match.team1Id, match.team2Id]) {
      if (!teamId) {
        continue;
      }
      const current = lastMatchForTeam.get(teamId);
      if (!current || match.round > current.round) {
        lastMatchForTeam.set(teamId, match);
      }
    }
  }

  // A round is the final if and only if it has exactly one match — by
  // construction (round 1 pads to a power of 2), every round has half as
  // many matches as the one before it, down to 1 for the final. This is
  // more reliable than "the highest round number seen so far": while a
  // round's matches are still being played, later rounds don't exist in
  // `matches` yet, which would otherwise make an in-progress round look
  // like the final.
  const matchCountByRound = new Map<number, number>();
  for (const match of matches) {
    matchCountByRound.set(match.round, (matchCountByRound.get(match.round) ?? 0) + 1);
  }

  return teamIds.map((teamId) => {
    const lastMatch = lastMatchForTeam.get(teamId);
    if (!lastMatch) {
      return { teamId, status: "ACTIVE", eliminatedInRound: null };
    }

    const isDecided = lastMatch.status === "COMPLETED" || lastMatch.status === "WALKOVER";
    if (!isDecided) {
      return { teamId, status: "ACTIVE", eliminatedInRound: null };
    }

    if (lastMatch.winnerTeamId !== teamId) {
      return { teamId, status: "ELIMINATED", eliminatedInRound: lastMatch.round };
    }

    if (matchCountByRound.get(lastMatch.round) === 1) {
      return { teamId, status: "CHAMPION", eliminatedInRound: null };
    }

    return { teamId, status: "ACTIVE", eliminatedInRound: null };
  });
}
