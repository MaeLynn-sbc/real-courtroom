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
  // Owner request (2026-08-11): true once this row's tie survived all
  // five USAP tiebreakers below and was ordered arbitrarily (by teamId)
  // as a last resort — a GENUINE unresolved tie, not just "tied on
  // wins." Staff-only surface (standings-table.tsx flags it); the
  // public table never shows this per-row, it only explains the
  // tiebreaker order in prose (see TIEBREAKER_ORDER_DESCRIPTION).
  tiedAfterAllTiebreakers: boolean;
}

// Published on the public standings page (PublicStandingsTable) so
// players can see how placement is decided, same USAP order this file
// implements below. Keep this in sync with the levels 1-5 logic.
export const TIEBREAKER_ORDER_DESCRIPTION = [
  "wins",
  "head-to-head wins among tied teams",
  "point differential (all games)",
  "head-to-head point differential",
  "point differential vs. the next-highest team",
  "total points scored",
] as const;

interface DecidedMatch {
  team1Id: string;
  team2Id: string;
  winnerTeamId: string;
  scores: { team1Score: number; team2Score: number }[];
}

function toDecidedMatches(matches: StandingsMatchInput[]): DecidedMatch[] {
  const decided: DecidedMatch[] = [];
  for (const match of matches) {
    if (match.status !== "COMPLETED" && match.status !== "WALKOVER") {
      continue;
    }
    if (!match.team2Id || !match.winnerTeamId) {
      continue;
    }
    decided.push({
      team1Id: match.team1Id,
      team2Id: match.team2Id,
      winnerTeamId: match.winnerTeamId,
      scores: match.scores,
    });
  }
  return decided;
}

// Groups items by descending score, preserving score-group order — the
// building block every cascade level uses. Two items with the same
// score land in the same group (still tied at this level); the caller
// decides whether to recurse into a group or accept it as resolved.
function groupByDescending<T>(items: T[], scoreOf: (item: T) => number): T[][] {
  const byScore = new Map<number, T[]>();
  for (const item of items) {
    const score = scoreOf(item);
    const existing = byScore.get(score);
    if (existing) {
      existing.push(item);
    } else {
      byScore.set(score, [item]);
    }
  }
  return Array.from(byScore.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, group]) => group);
}

// Level 1 — wins in games played strictly among the tied set (a "mini
// round robin" of just this group). A cycle (A beat B, B beat C, C beat
// A) gives every team exactly 1 head-to-head win — still tied, falls
// through to level 2 for the whole trio.
function headToHeadWins(teamId: string, tiedIds: Set<string>, decidedMatches: DecidedMatch[]): number {
  let wins = 0;
  for (const match of decidedMatches) {
    if (!tiedIds.has(match.team1Id) || !tiedIds.has(match.team2Id)) continue;
    if (match.team1Id !== teamId && match.team2Id !== teamId) continue;
    if (match.winnerTeamId === teamId) wins += 1;
  }
  return wins;
}

// Level 3 — same subset-filtering as level 1, but summing point margin
// instead of counting wins.
function headToHeadPointDifferential(
  teamId: string,
  tiedIds: Set<string>,
  decidedMatches: DecidedMatch[],
): number {
  let diff = 0;
  for (const match of decidedMatches) {
    if (!tiedIds.has(match.team1Id) || !tiedIds.has(match.team2Id)) continue;
    for (const score of match.scores) {
      if (match.team1Id === teamId) {
        diff += score.team1Score - score.team2Score;
      } else if (match.team2Id === teamId) {
        diff += score.team2Score - score.team1Score;
      }
    }
  }
  return diff;
}

// Level 4 — point margin specifically against the team ranked
// immediately above this tied group. Returns null (not 0) when the two
// never played, so "never played" can't masquerade as "tied at zero" —
// the caller treats null as "this level can't fairly rank the group,
// skip to level 5."
function pointDifferentialAgainst(
  teamId: string,
  referenceTeamId: string,
  decidedMatches: DecidedMatch[],
): number | null {
  let diff = 0;
  let played = false;
  for (const match of decidedMatches) {
    const isThisPair =
      (match.team1Id === teamId && match.team2Id === referenceTeamId) ||
      (match.team2Id === teamId && match.team1Id === referenceTeamId);
    if (!isThisPair) continue;
    played = true;
    for (const score of match.scores) {
      diff += match.team1Id === teamId ? score.team1Score - score.team2Score : score.team2Score - score.team1Score;
    }
  }
  return played ? diff : null;
}

// Recursively narrows a tied group through tiebreaker levels 1-5.
//
// DELIBERATE, CONFIRMED WITH THE OWNER (2026-08-11) — do not "fix"
// this: `teamAboveId` is fixed ONCE, for the ENTIRE resolution of one
// win-tied cluster (whoever the cascade already placed immediately
// above it, from the previous, higher win-group). It is NOT
// recomputed against not-yet-finalized sibling sub-groups partway
// through this same cluster's own resolution, even though a 4+ way
// tie can partially resolve at levels 1-3 before any of them reach
// level 4. USAP's own example ("teams tied for second, compare
// against first place") describes a single undifferentiated tied
// cluster and doesn't address this nested case; recomputing
// `teamAboveId` mid-recursion against a sibling's still-provisional
// placement was considered and explicitly rejected — it would make a
// team's level-4 comparison depend on the ORDER sub-groups happen to
// resolve in, which is not a real ranking signal. Keep comparing
// everyone still tied against the ORIGINAL team above the whole
// cluster.
function rankGroup(
  rowsById: Map<string, RoundRobinStandingRow>,
  tiedTeamIds: string[],
  level: number,
  teamAboveId: string | null,
  decidedMatches: DecidedMatch[],
): string[] {
  if (tiedTeamIds.length <= 1) {
    return tiedTeamIds;
  }

  if (level > 5) {
    // Genuine, fully unresolved tie — every USAP tiebreaker exhausted.
    // Flag every row so staff can see it; order is arbitrary (by
    // teamId) but stable.
    for (const teamId of tiedTeamIds) {
      rowsById.get(teamId)!.tiedAfterAllTiebreakers = true;
    }
    return [...tiedTeamIds].sort((a, b) => a.localeCompare(b));
  }

  const tiedSet = new Set(tiedTeamIds);
  let groups: string[][];

  if (level === 1) {
    groups = groupByDescending(tiedTeamIds, (id) => headToHeadWins(id, tiedSet, decidedMatches));
  } else if (level === 2) {
    groups = groupByDescending(tiedTeamIds, (id) => rowsById.get(id)!.pointDifferential);
  } else if (level === 3) {
    groups = groupByDescending(tiedTeamIds, (id) => headToHeadPointDifferential(id, tiedSet, decidedMatches));
  } else if (level === 4) {
    if (!teamAboveId) {
      // Tied for 1st — no "next-highest" team exists.
      return rankGroup(rowsById, tiedTeamIds, 5, teamAboveId, decidedMatches);
    }
    const valueById = new Map(
      tiedTeamIds.map((id) => [id, pointDifferentialAgainst(id, teamAboveId, decidedMatches)] as const),
    );
    if (Array.from(valueById.values()).some((value) => value === null)) {
      // At least one tied team never played the reference team — can't
      // fairly rank the group on this level.
      return rankGroup(rowsById, tiedTeamIds, 5, teamAboveId, decidedMatches);
    }
    groups = groupByDescending(tiedTeamIds, (id) => valueById.get(id)!);
  } else {
    groups = groupByDescending(tiedTeamIds, (id) => rowsById.get(id)!.pointsFor);
  }

  const result: string[] = [];
  for (const group of groups) {
    if (group.length === 1) {
      result.push(group[0]!);
    } else {
      result.push(...rankGroup(rowsById, group, level + 1, teamAboveId, decidedMatches));
    }
  }
  return result;
}

function rankByTiebreakerCascade(
  rows: RoundRobinStandingRow[],
  decidedMatches: DecidedMatch[],
): RoundRobinStandingRow[] {
  const rowsById = new Map(rows.map((row) => [row.teamId, row]));
  const winGroups = groupByDescending(
    rows.map((row) => row.teamId),
    (id) => rowsById.get(id)!.wins,
  );

  const orderedIds: string[] = [];
  let teamAboveId: string | null = null;
  for (const group of winGroups) {
    const ranked = rankGroup(rowsById, group, 1, teamAboveId, decidedMatches);
    orderedIds.push(...ranked);
    teamAboveId = ranked[ranked.length - 1]!;
  }

  return orderedIds.map((id) => rowsById.get(id)!);
}

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
        tiedAfterAllTiebreakers: false,
      },
    ]),
  );

  const decidedMatches = toDecidedMatches(matches);

  for (const match of decidedMatches) {
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

  return rankByTiebreakerCascade(Array.from(rows.values()), decidedMatches);
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
