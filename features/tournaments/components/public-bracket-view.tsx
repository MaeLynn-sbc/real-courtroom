import { PublicEliminationBracket } from "@/features/tournaments/components/public-elimination-bracket";
import { PublicMatchCard } from "@/features/tournaments/components/public-match-card";
import { PublicPlayoffSection } from "@/features/tournaments/components/public-playoff-section";
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

// Fix (2026-08-12): this public page never grouped by pool at all — a
// pooled ROUND_ROBIN category's Pool A "Round 1" and Pool B "Round 1"
// were silently merged into one "Round 1" bucket, the only way to tell
// two matches apart was reading full team rosters. Same grouping
// bracket-view.tsx (the staff view) already has.
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
  matches,
  teamPoolNumbers,
}: {
  matches: MatchWithTeams[];
  teamPoolNumbers: Record<string, string | null>;
}) {
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
              <PublicMatchCard key={match.id} match={match} teamPoolNumbers={teamPoolNumbers} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Public, read-only counterpart to bracket-view.tsx — same pool-then-
// round grouping, PublicMatchCard instead of the staff-mutating
// MatchCard. teamPoolNumbers threads each team's "1a"/"2a" display
// number (services/tournaments/bracket-generator.ts's
// formatTeamPoolNumber) down to PublicMatchCard.
export function PublicBracketView({
  matches,
  teamPoolNumbers,
  format,
  hasThirdPlaceMatch,
}: {
  matches: MatchWithTeams[];
  teamPoolNumbers: Record<string, string | null>;
  format?: string;
  hasThirdPlaceMatch?: boolean;
}) {
  if (matches.length === 0) {
    return null;
  }

  // A knockout draw gets the real bracket treatment (named round columns,
  // match codes, "Winner QF1" placeholders). Round robin — pooled or not —
  // keeps the flat round grouping below, which is the right shape for it.
  if (format === "SINGLE_ELIMINATION") {
    return (
      <PublicEliminationBracket
        matches={matches}
        teamPoolNumbers={teamPoolNumbers}
        hasThirdPlaceMatch={hasThirdPlaceMatch}
      />
    );
  }

  // Playoff matches are pulled OUT of the pool grouping below and shown
  // in their own section above it. Without this they would appear as
  // stray fixtures inside whichever pool round they happened to be given,
  // which is exactly the confusion the stage column exists to fix.
  const playoffMatches = matches.filter((match) => match.stage !== null);
  const poolMatches = matches.filter((match) => match.stage === null);

  const pools = Array.from(groupByPool(poolMatches).entries()).sort(([a], [b]) =>
    (a ?? "").localeCompare(b ?? ""),
  );
  const isPooled = pools.length > 1 || pools[0]?.[0] !== null;

  if (!isPooled) {
    return (
      <div className="flex flex-col gap-6">
        <PublicPlayoffSection matches={playoffMatches} teamPoolNumbers={teamPoolNumbers} />
        <RoundGroups matches={poolMatches} teamPoolNumbers={teamPoolNumbers} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Playoffs FIRST — once they exist they are the thing people are
          looking for, and the pools become reference below them. Renders
          nothing when no match has a stage, so an ordinary round robin is
          unchanged. */}
      <PublicPlayoffSection matches={playoffMatches} teamPoolNumbers={teamPoolNumbers} />
      {pools.map(([poolLabel, poolMatches]) => (
        <div key={poolLabel ?? "none"} className="flex flex-col gap-2">
          <h3 className="font-jetbrains text-bone text-xs font-bold tracking-[0.18em] uppercase">
            Pool {poolLabel ?? "—"}
          </h3>
          <RoundGroups matches={poolMatches} teamPoolNumbers={teamPoolNumbers} />
        </div>
      ))}
    </div>
  );
}
