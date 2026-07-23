import { prisma } from "@/lib/prisma";

export interface PlayerStatisticsResult {
  bookingsCount: number;
  completedBookingsCount: number;
  openPlaySessionsAttended: number;
  openPlayMatchesPlayed: number;
  tournamentsPlayed: number;
  tournamentMatchesPlayed: number;
  tournamentMatchesWon: number;
  tournamentWinPercentage: number;
  currentEloRating: number | null;
}

// Everything here is computed live from Booking/Open Play/Tournament data
// rather than read from the stored PlayerStatistics table — per this
// phase's explicit recommendation, that table is never written to (see
// ARCHITECTURE.md's Phase 7 addendum). PlayerRating (ELO/DUPR) is the one
// exception: it's an existing stored field, left untouched and simply
// read here, since AI-generated ratings are out of scope.
export class PlayerStatisticsService {
  async getPlayerStatistics(playerId: string): Promise<PlayerStatisticsResult> {
    const teams = await prisma.team.findMany({
      where: { OR: [{ player1Id: playerId }, { player2Id: playerId }] },
      select: { id: true },
    });
    const teamIds = teams.map((team) => team.id);

    const [
      bookingsCount,
      completedBookingsCount,
      openPlaySessionsAttended,
      openPlayMatchesPlayed,
      tournamentRegistrations,
      tournamentMatchesPlayed,
      tournamentMatchesWon,
      rating,
    ] = await Promise.all([
      prisma.booking.count({ where: { playerId } }),
      prisma.booking.count({ where: { playerId, status: "COMPLETED" } }),
      prisma.openPlayRegistration.count({ where: { playerId, status: "CHECKED_IN" } }),
      prisma.openPlayMatchParticipant.count({ where: { registration: { playerId } } }),
      prisma.tournamentRegistration.findMany({
        where: { teamId: { in: teamIds } },
        select: { tournamentCategory: { select: { tournamentId: true } } },
      }),
      prisma.match.count({ where: { OR: [{ team1Id: { in: teamIds } }, { team2Id: { in: teamIds } }] } }),
      prisma.match.count({ where: { winnerTeamId: { in: teamIds } } }),
      prisma.playerRating.findUnique({ where: { playerId } }),
    ]);

    const tournamentsPlayed = new Set(
      tournamentRegistrations.map((registration) => registration.tournamentCategory.tournamentId),
    ).size;

    return {
      bookingsCount,
      completedBookingsCount,
      openPlaySessionsAttended,
      openPlayMatchesPlayed,
      tournamentsPlayed,
      tournamentMatchesPlayed,
      tournamentMatchesWon,
      tournamentWinPercentage:
        tournamentMatchesPlayed > 0 ? (tournamentMatchesWon / tournamentMatchesPlayed) * 100 : 0,
      currentEloRating: rating?.eloRating ?? null,
    };
  }
}

export const playerStatisticsService = new PlayerStatisticsService();
