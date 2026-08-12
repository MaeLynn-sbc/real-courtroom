import type { MatchWithTeams } from "@/features/tournaments/components/match-card";
import type { MatchStatus } from "@/lib/generated/prisma/enums";

const timeFormatter = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const STATUS_LABELS: Record<MatchStatus, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  WALKOVER: "Walkover",
};

// Owner request (2026-08-12): "can the team has numbers. like what
// number they are in the pool or bracket" — optional "1a"/"2a" prefix,
// same convention as match-card.tsx's own teamLabel.
function teamLabel(team: MatchWithTeams["team1"] | MatchWithTeams["team2"], number?: string | null): string {
  if (!team) {
    return "BYE";
  }
  const player1Name = team.player1.user.name ?? "Unknown player";
  const base = team.player2 ? `${player1Name} / ${team.player2.user.name ?? "Unknown player"}` : player1Name;
  return number ? `${number}. ${base}` : base;
}

// Public, read-only counterpart to match-card.tsx — same data
// (matchService.listMatchesByCategory), no staff mutation UI (no score
// entry, no court/schedule pickers, no walkover buttons). Never exposes
// email — team names use User.name only, unlike the staff card's own
// `?? user.email` fallback (a player's email has no business being on a
// public page).
export function PublicMatchCard({
  match,
  teamPoolNumbers,
}: {
  match: MatchWithTeams;
  teamPoolNumbers: Record<string, string | null>;
}) {
  const isBye = match.team2 === null;
  const isLive = match.status === "IN_PROGRESS";

  return (
    <div className="border-line bg-navy-800 flex flex-col gap-2 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-jetbrains text-[10px] font-bold tracking-[0.14em] uppercase">
          <span className={isLive ? "text-coral" : "text-slate"}>{STATUS_LABELS[match.status]}</span>
        </span>
        {/* Owner request (2026-08-11): "staff can see it; players should
            too" — scheduledAt already existed on Match, just wasn't
            surfaced here. Shown next to the court, same "· "-joined
            convention as the score line below. */}
        {match.court || match.scheduledAt ? (
          <span className="text-slate text-xs">
            {[match.court?.name, match.scheduledAt ? timeFormatter.format(match.scheduledAt) : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : null}
      </div>

      {isBye ? (
        <p className="text-bone text-sm font-medium">
          {teamLabel(match.team1, teamPoolNumbers[match.team1Id])} — bye
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            {[match.team1, match.team2].map((team, index) => {
              const teamId = index === 0 ? match.team1Id : match.team2Id;
              const isWinner = match.winnerTeamId !== null && match.winnerTeamId === teamId;
              return (
                <div
                  key={index}
                  className={`flex items-center justify-between gap-3 text-sm ${
                    isWinner ? "text-bone font-semibold" : "text-slate"
                  }`}
                >
                  <span>{teamLabel(team, teamId ? teamPoolNumbers[teamId] : null)}</span>
                  {match.scores.length > 0 ? (
                    <span className="font-jetbrains tabular-nums">
                      {match.scores
                        .map((score) => (index === 0 ? score.team1Score : score.team2Score))
                        .join(" · ")}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
