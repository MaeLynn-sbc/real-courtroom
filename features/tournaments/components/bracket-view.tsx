import { MatchCard, type MatchWithTeams } from "@/features/tournaments/components/match-card";

interface BracketViewProps {
  tournamentId: string;
  categoryId: string;
  matches: MatchWithTeams[];
  courts: { id: string; name: string }[];
}

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

export function BracketView({ tournamentId, categoryId, matches, courts }: BracketViewProps) {
  if (matches.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No bracket yet — generate it once teams are registered.
      </p>
    );
  }

  const rounds = Array.from(groupByRound(matches).entries()).sort(([a], [b]) => a - b);

  return (
    <div className="flex flex-col gap-6">
      {rounds.map(([round, roundMatches]) => (
        <div key={round} className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Round {round}</h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {roundMatches.map((match) => (
              <MatchCard
                key={match.id}
                tournamentId={tournamentId}
                categoryId={categoryId}
                match={match}
                courts={courts}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
