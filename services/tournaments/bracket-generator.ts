// Pure and dependency-free (no Prisma import) so it's unit-testable without
// a database — same pattern as services/court/court-availability.ts and
// services/booking/booking-availability.ts. tournament.service.ts and
// match.service.ts are the only callers; they own all database access.

export interface RoundRobinPairing {
  round: number;
  team1Id: string;
  team2Id: string;
}

export interface EliminationPairing {
  team1Id: string;
  /** null means this slot is an automatic bye — team1Id advances without playing. */
  team2Id: string | null;
}

// Standard "circle method": fix the first team, rotate the rest one
// position each round. An odd team count is padded with a null bye slot
// internally — pairings involving it are simply dropped from the output,
// which spreads exactly one bye per team across the rounds.
export function generateRoundRobinPairings(teamIds: string[]): RoundRobinPairing[] {
  if (teamIds.length < 2) {
    return [];
  }

  const teams: (string | null)[] = [...teamIds];
  if (teams.length % 2 !== 0) {
    teams.push(null);
  }

  const n = teams.length;
  const half = n / 2;
  const numRounds = n - 1;
  const fixed = teams[0];
  const rotating = teams.slice(1);
  const pairings: RoundRobinPairing[] = [];

  for (let round = 0; round < numRounds; round += 1) {
    const roundTeams = [fixed, ...rotating];

    for (let i = 0; i < half; i += 1) {
      const team1 = roundTeams[i];
      const team2 = roundTeams[n - 1 - i];

      if (team1 !== null && team2 !== null) {
        pairings.push({ round: round + 1, team1Id: team1, team2Id: team2 });
      }
    }

    rotating.unshift(rotating.pop() as string | null);
  }

  return pairings;
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) {
    result *= 2;
  }
  return result;
}

// Pads the field to the next power of 2 with byes so every subsequent
// round is a clean pairing of winners. No seeding/ranking system exists
// yet, so byes are assigned deterministically to the first N teams in the
// given order rather than by any notion of "fairness" — AI/ranked bracket
// seeding is explicitly out of scope for this phase.
export function generateSingleEliminationRound1(teamIds: string[]): EliminationPairing[] {
  if (teamIds.length < 2) {
    return [];
  }

  const targetSize = nextPowerOfTwo(teamIds.length);
  const byeCount = targetSize - teamIds.length;
  const queue = [...teamIds];
  const pairings: EliminationPairing[] = [];

  for (let i = 0; i < byeCount; i += 1) {
    const team = queue.shift();
    if (team) {
      pairings.push({ team1Id: team, team2Id: null });
    }
  }

  while (queue.length >= 2) {
    const team1 = queue.shift() as string;
    const team2 = queue.shift() as string;
    pairings.push({ team1Id: team1, team2Id: team2 });
  }

  return pairings;
}

// Pairs up a completed round's winners (already in bracket order) into
// the next round's matchups. Because round 1 padded to a power of 2, every
// pairing from here on is a real match — no more byes are possible.
// Returns an empty array if fewer than 2 winners remain (the previous
// round was the final).
export function pairNextRound(winnerTeamIds: string[]): EliminationPairing[] {
  const pairings: EliminationPairing[] = [];

  for (let i = 0; i < winnerTeamIds.length - 1; i += 2) {
    pairings.push({ team1Id: winnerTeamIds[i], team2Id: winnerTeamIds[i + 1] });
  }

  return pairings;
}
