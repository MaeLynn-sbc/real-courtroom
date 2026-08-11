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
  // Owner request (2026-08-11): the real tiebreaker — USAP order ranks on
  // point differential, not set differential (a set win by 11-0 and a set
  // win by 11-9 both count as "+1 set," which can't tell two teams with
  // the same win-loss record apart the way actual point margin can).
  // Summed from every recorded Score row, kept alongside setDifferential
  // (still shown, still useful) rather than replacing it.
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
}

// Sorted by wins desc, then POINT differential desc (see
// RoundRobinStandingRow.pointDifferential's own comment), then teamId for
// a stable tiebreak. This is still a single-key sort, not the full USAP
// head-to-head cascade — that's a separate, larger change (tied-subset
// grouping + rank-relative tiebreak 4), deliberately not done here.
export function calculateRoundRobinStandings(
  teamIds: string[],
  matches: StandingsMatchInput[],
): RoundRobinStandingRow[] {
  const rows = new Map<string, RoundRobinStandingRow>(
    teamIds.map((teamId) => [
      teamId,
      {
        teamId,
        played: 0,
        wins: 0,
        losses: 0,
        setsWon: 0,
        setsLost: 0,
        setDifferential: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
      },
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
    // Owner report (2026-08-11): "a withdrawn team's completed matches
    // must still count toward their OPPONENTS' records" — a withdrawn
    // team has no row (standings.service.ts only seeds `rows` from
    // CONFIRMED registrations), but that must only erase THEIR OWN
    // standing, not retroactively strip a legitimate win from whoever
    // they played. Update whichever row(s) actually exist instead of
    // skipping the whole match when either side is missing.
    if (!row1 && !row2) {
      continue;
    }

    let setsWon1 = 0;
    let setsWon2 = 0;
    let points1 = 0;
    let points2 = 0;
    for (const score of match.scores) {
      if (score.team1Score > score.team2Score) {
        setsWon1 += 1;
      } else if (score.team2Score > score.team1Score) {
        setsWon2 += 1;
      }
      points1 += score.team1Score;
      points2 += score.team2Score;
    }

    if (row1) {
      row1.played += 1;
      row1.setsWon += setsWon1;
      row1.setsLost += setsWon2;
      row1.pointsFor += points1;
      row1.pointsAgainst += points2;
      if (match.winnerTeamId === match.team1Id) {
        row1.wins += 1;
      } else {
        row1.losses += 1;
      }
    }
    if (row2) {
      row2.played += 1;
      row2.setsWon += setsWon2;
      row2.setsLost += setsWon1;
      row2.pointsFor += points2;
      row2.pointsAgainst += points1;
      if (match.winnerTeamId === match.team2Id) {
        row2.wins += 1;
      } else {
        row2.losses += 1;
      }
    }
  }

  for (const row of rows.values()) {
    row.setDifferential = row.setsWon - row.setsLost;
    row.pointDifferential = row.pointsFor - row.pointsAgainst;
  }

  return Array.from(rows.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointDifferential !== a.pointDifferential) return b.pointDifferential - a.pointDifferential;
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
