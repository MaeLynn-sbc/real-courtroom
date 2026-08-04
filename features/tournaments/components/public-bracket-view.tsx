import { PublicMatchCard } from "@/features/tournaments/components/public-match-card";
import type { MatchWithTeams } from "@/features/tournaments/components/match-card";

function groupByRound(matches: MatchWithTeams[]): Map<number, MatchWithTeams[]> {
  const groups = new Map<number, MatchWithTeams[]>();
  for (const match of matches) {
    const round = match.round ?? 0;
    const group = groups.get(round);
    if (group) {
      group.push(match);
    } else {
      groups.set(round, [match]);
    }
  }
  return groups;
}

// Public, read-only counterpart to bracket-view.tsx — same round-by-round
// grouping, PublicMatchCard instead of the staff-mutating MatchCard.
export function PublicBracketView({ matches }: { matches: MatchWithTeams[] }) {
  if (matches.length === 0) {
    return null;
  }

  const rounds = Array.from(groupByRound(matches).entries()).sort(([a], [b]) => a - b);

  return (
    <div className="flex flex-col gap-4">
      {rounds.map(([round, roundMatches]) => (
        <div key={round} className="flex flex-col gap-2">
          <h4 className="font-jetbrains text-slate text-[11px] font-bold tracking-[0.18em] uppercase">
            Round {round}
          </h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {roundMatches.map((match) => (
              <PublicMatchCard key={match.id} match={match} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
