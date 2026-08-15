import { prisma } from "@/lib/prisma";
import {
  calculateEliminationStandings,
  calculateRoundRobinStandings,
  type EliminationStandingRow,
  type RoundRobinStandingRow,
  type StandingsMatchInput,
} from "@/services/tournaments/standings-calculator";

export type StandingsResult =
  | { format: "ROUND_ROBIN"; rows: RoundRobinStandingRow[] }
  | { format: "SINGLE_ELIMINATION"; rows: EliminationStandingRow[] };

export class StandingsService {
  async getStandings(categoryId: string): Promise<StandingsResult> {
    const category = await prisma.tournamentCategory.findUniqueOrThrow({ where: { id: categoryId } });

    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentCategoryId: categoryId, status: "CONFIRMED" },
      select: { teamId: true, poolLabel: true },
    });

    const matches = await prisma.match.findMany({
      where: { tournamentCategoryId: categoryId },
      include: { scores: { select: { team1Score: true, team2Score: true } } },
    });

    const matchInputs: StandingsMatchInput[] = matches.map((match) => ({
      round: match.round ?? 0,
      team1Id: match.team1Id,
      team2Id: match.team2Id,
      winnerTeamId: match.winnerTeamId,
      status: match.status,
      scores: match.scores,
    }));

    if (category.format === "ROUND_ROBIN") {
      // Owner request (2026-08-15): "can we fix first the standing? can
      // we sort it by pool and not the whole roster" — a pooled round
      // robin never has cross-pool matches (generateBracket's pooled
      // path only pairs teams within their own pool), so ranking teams
      // against each other across different pools doesn't mean
      // anything: they never actually played. Ranks each pool
      // separately (calculateRoundRobinStandings called once per pool,
      // its own tiebreaker cascade scoped to just that pool's matches),
      // then concatenates pool by pool in the same alphabetical order
      // bracket-view.tsx's own groupByPool uses, instead of one flat
      // roster-wide ranking. A category with no pools assigned still
      // gets the same single-group behavior as before (one entry keyed
      // by null).
      const teamIdsByPool = new Map<string | null, string[]>();
      for (const registration of registrations) {
        const list = teamIdsByPool.get(registration.poolLabel) ?? [];
        list.push(registration.teamId);
        teamIdsByPool.set(registration.poolLabel, list);
      }
      const rows = Array.from(teamIdsByPool.entries())
        .sort(([a], [b]) => (a ?? "").localeCompare(b ?? ""))
        .flatMap(([poolLabel, poolTeamIds]) =>
          calculateRoundRobinStandings(poolTeamIds, matchInputs).map((row) => ({ ...row, poolLabel })),
        );
      return { format: "ROUND_ROBIN", rows };
    }

    // Single Elimination is the other creatable format; DOUBLE_ELIMINATION
    // and POOL_PLAY can't be created this phase (see tournament.schema.ts)
    // so this branch never actually runs for them, but falls back to the
    // same elimination-shaped view rather than throwing if it ever does.
    const teamIds = registrations.map((registration) => registration.teamId);
    return { format: "SINGLE_ELIMINATION", rows: calculateEliminationStandings(teamIds, matchInputs) };
  }
}

export const standingsService = new StandingsService();
