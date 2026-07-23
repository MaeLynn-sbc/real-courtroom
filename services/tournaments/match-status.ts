import type { MatchStatus } from "@/lib/generated/prisma/enums";

// Pure state machine — same shape as services/booking/booking-status.ts.
// WALKOVER is reachable from either SCHEDULED or IN_PROGRESS (a team can
// forfeit before or after play starts) and is terminal, same as COMPLETED.
export const MATCH_STATUS_TRANSITIONS: Record<MatchStatus, MatchStatus[]> = {
  SCHEDULED: ["IN_PROGRESS", "CANCELLED", "WALKOVER"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED", "WALKOVER"],
  COMPLETED: [],
  CANCELLED: [],
  WALKOVER: [],
};

export function canTransitionMatchStatus(from: MatchStatus, to: MatchStatus): boolean {
  if (from === to) {
    return false;
  }
  return MATCH_STATUS_TRANSITIONS[from].includes(to);
}

export interface SetScore {
  team1Score: number;
  team2Score: number;
}

// Winner is whichever team won more sets among the entered Score rows —
// no assumption about set format (best-of-3, single game to 11/15/21,
// win-by-2) is baked in, since that varies by tournament and wasn't
// specified. Returns null when there's nothing to decide a winner from
// (no sets entered, or a tie), meaning the match cannot yet be completed.
export function determineMatchWinner(
  scores: SetScore[],
  team1Id: string,
  team2Id: string | null,
): string | null {
  if (!team2Id) {
    return team1Id;
  }

  let team1Sets = 0;
  let team2Sets = 0;
  for (const score of scores) {
    if (score.team1Score > score.team2Score) {
      team1Sets += 1;
    } else if (score.team2Score > score.team1Score) {
      team2Sets += 1;
    }
  }

  if (team1Sets === team2Sets) {
    return null;
  }
  return team1Sets > team2Sets ? team1Id : team2Id;
}
