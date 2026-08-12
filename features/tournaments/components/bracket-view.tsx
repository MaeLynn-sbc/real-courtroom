import { MatchCard, type MatchWithTeams } from "@/features/tournaments/components/match-card";

interface BracketViewProps {
  tournamentId: string;
  categoryId: string;
  matches: MatchWithTeams[];
  teamPoolNumbers: Record<string, string | null>;
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

// Owner request (2026-08-11): "create 2 brackets... then it will auto
// create the match" — a pooled round robin restarts round numbers at 1
// within EACH pool (see generateBracket's own comment), so grouping by
// round alone would merge Pool A's Round 1 with Pool B's Round 1 into
// one "Round 1" bucket. Grouped by pool first (only when any match here
// actually has one — an ordinary, non-pooled category's matches all
// have poolLabel: null and fall back to exactly the plain
// Round-N display this already had).
function groupByPool(matches: MatchWithTeams[]): Map<string | null, MatchWithTeams[]> {
  const groups = new Map<string | null, MatchWithTeams[]>();
  for (const match of matches) {
    const group = groups.get(match.poolLabel);
    if (group) {
      group.push(match);
    } else {
      groups.set(match.poolLabel, [match]);
    }
  }
  return groups;
}

function RoundGroups({
  tournamentId,
  categoryId,
  matches,
  teamPoolNumbers,
}: {
  tournamentId: string;
  categoryId: string;
  matches: MatchWithTeams[];
  teamPoolNumbers: Record<string, string | null>;
}) {
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
                teamPoolNumbers={teamPoolNumbers}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function BracketView({ tournamentId, categoryId, matches, teamPoolNumbers }: BracketViewProps) {
  if (matches.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No bracket yet — generate it once teams are registered.
      </p>
    );
  }

  const pools = Array.from(groupByPool(matches).entries()).sort(([a], [b]) =>
    (a ?? "").localeCompare(b ?? ""),
  );
  const isPooled = pools.length > 1 || pools[0]?.[0] !== null;

  if (!isPooled) {
    return (
      <RoundGroups
        tournamentId={tournamentId}
        categoryId={categoryId}
        matches={matches}
        teamPoolNumbers={teamPoolNumbers}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {pools.map(([poolLabel, poolMatches]) => (
        <div key={poolLabel ?? "none"} className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">Pool {poolLabel ?? "—"}</h3>
          <RoundGroups
            tournamentId={tournamentId}
            categoryId={categoryId}
            matches={poolMatches}
            teamPoolNumbers={teamPoolNumbers}
          />
        </div>
      ))}
    </div>
  );
}
