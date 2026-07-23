import { Card, CardContent } from "@/components/ui/card";
import type { PlayerStatisticsResult } from "@/services/player/player-statistics.service";

const STAT_LABELS: Record<keyof Omit<PlayerStatisticsResult, "currentEloRating">, string> = {
  bookingsCount: "Bookings",
  completedBookingsCount: "Completed Bookings",
  openPlaySessionsAttended: "Open Play Attended",
  openPlayMatchesPlayed: "Open Play Matches",
  tournamentsPlayed: "Tournaments",
  tournamentMatchesPlayed: "Tournament Matches",
  tournamentMatchesWon: "Tournament Wins",
  tournamentWinPercentage: "Win %",
};

// All numbers here are computed live from Booking/Open Play/Tournament
// data — see player-statistics.service.ts. Nothing is read from the
// stored PlayerStatistics table.
export function PlayerStatsDashboard({ stats }: { stats: PlayerStatisticsResult }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(STAT_LABELS) as Array<keyof typeof STAT_LABELS>).map((key) => (
          <Card key={key} size="sm">
            <CardContent className="flex flex-col items-center gap-1 py-1 text-center">
              <span className="text-2xl font-semibold tabular-nums">
                {key === "tournamentWinPercentage" ? `${stats[key].toFixed(0)}%` : stats[key]}
              </span>
              <span className="text-muted-foreground text-xs">{STAT_LABELS[key]}</span>
            </CardContent>
          </Card>
        ))}
      </div>
      {stats.currentEloRating !== null ? (
        <p className="text-muted-foreground text-sm">Current ELO rating: {stats.currentEloRating}</p>
      ) : null}
    </div>
  );
}
