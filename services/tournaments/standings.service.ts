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
      select: { teamId: true },
    });
    const teamIds = registrations.map((registration) => registration.teamId);

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
      return { format: "ROUND_ROBIN", rows: calculateRoundRobinStandings(teamIds, matchInputs) };
    }

    // Single Elimination is the other creatable format; DOUBLE_ELIMINATION
    // and POOL_PLAY can't be created this phase (see tournament.schema.ts)
    // so this branch never actually runs for them, but falls back to the
    // same elimination-shaped view rather than throwing if it ever does.
    return { format: "SINGLE_ELIMINATION", rows: calculateEliminationStandings(teamIds, matchInputs) };
  }
}

export const standingsService = new StandingsService();
