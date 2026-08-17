import type { MatchWithTeams } from "@/features/tournaments/components/match-card";
import { PublicMatchCard } from "@/features/tournaments/components/public-match-card";
import { BRONZE_BRACKET_POSITION } from "@/services/tournaments/bracket-generator";

// Owner request (2026-08-17), against a reference bracket: named round
// columns (Quarterfinals / Semifinals / Final), short match codes
// (QF1, SF2, FINAL), and — the part that actually needed thought —
// PLACEHOLDER cards for matches that don't exist yet, reading
// "Winner QF1" / "Winner QF2".
//
// Why no schema change was needed: tryAdvanceBracket only creates a
// round's Match rows once both feeder matches complete, so the Final
// genuinely has no row (and can't — Match.team1Id is non-nullable) until
// the semis are done. But the bracket's SHAPE is fully derivable from the
// first round's size, and the feed relationship is already fixed by
// deleteMatch's own guard: a match at (round r, position p) feeds
// (r + 1, floor(p / 2)). Inverting that gives every future slot's two
// feeders, which is exactly what the placeholder text needs. So this is a
// pure view concern — no new column, no change to how brackets advance.

const ROUND_NAMES_FROM_END = ["Final", "Semifinals", "Quarterfinals", "Round of 16"];
const ROUND_CODES_FROM_END = ["FINAL", "SF", "QF", "R16"];

// Rounds are named by distance from the END of the bracket, not by their
// own number — "round 2" is the semifinal in an 8-team draw but the final
// in a 4-team one. Anything deeper than the round of 16 falls back to a
// plain number rather than inventing names nobody uses.
export function roundName(round: number, totalRounds: number): string {
  return ROUND_NAMES_FROM_END[totalRounds - round] ?? `Round ${round}`;
}

// The short code on a card, and the one referenced by placeholders in the
// next column ("Winner QF1"). The final is unnumbered — there's only one.
export function matchCode(round: number, position: number, totalRounds: number): string {
  const code = ROUND_CODES_FROM_END[totalRounds - round];
  if (!code) {
    return `R${round}M${position + 1}`;
  }
  return code === "FINAL" ? "FINAL" : `${code}${position + 1}`;
}

function PlaceholderCard({ code, feeders }: { code: string; feeders: [string, string] }) {
  return (
    <div className="border-line bg-navy-800/50 flex flex-col gap-2 rounded-xl border border-dashed p-4">
      <span className="font-jetbrains text-slate text-[10px] font-bold tracking-[0.14em] uppercase">
        {code}
      </span>
      <div className="flex flex-col gap-1">
        {feeders.map((feeder) => (
          <span key={feeder} className="text-slate/70 text-sm italic">
            {feeder}
          </span>
        ))}
      </div>
    </div>
  );
}

export function PublicEliminationBracket({
  matches,
  teamPoolNumbers,
  hasThirdPlaceMatch = false,
}: {
  matches: MatchWithTeams[];
  teamPoolNumbers: Record<string, string | null>;
  hasThirdPlaceMatch?: boolean;
}) {
  // Manually-added matches carry no bracketPosition (see createManualMatch)
  // — they aren't part of the generated draw and are listed separately
  // below rather than being forced into a column they don't belong to.
  const bracketMatches = matches.filter(
    (match) => match.round !== null && match.bracketPosition !== null,
  );
  const looseMatches = matches.filter(
    (match) => match.round === null || match.bracketPosition === null,
  );

  if (bracketMatches.length === 0) {
    return null;
  }

  const firstRound = Math.min(...bracketMatches.map((match) => match.round as number));
  const firstRoundCount = bracketMatches.filter((match) => match.round === firstRound).length;
  // A 4-match opening round means 4 -> 2 -> 1, i.e. 3 rounds total.
  const totalRounds = Math.max(1, Math.ceil(Math.log2(Math.max(firstRoundCount, 1)))) + firstRound;

  const bySlot = new Map<string, MatchWithTeams>();
  for (const match of bracketMatches) {
    bySlot.set(`${match.round}:${match.bracketPosition}`, match);
  }

  const columns = [];
  for (let round = firstRound; round < totalRounds; round += 1) {
    const isFinalRound = round === totalRounds - 1;
    // The last column carries the final AND, when enabled, the bronze
    // playoff beside it — hence "Final · Bronze" in the reference.
    const slotCount =
      isFinalRound && hasThirdPlaceMatch ? 2 : Math.max(1, firstRoundCount >> (round - firstRound));
    const cells = [];
    for (let position = 0; position < slotCount; position += 1) {
      const isBronze = isFinalRound && position === BRONZE_BRACKET_POSITION;
      const match = bySlot.get(`${round}:${position}`);
      const code = isBronze ? "BRONZE" : matchCode(round, position, totalRounds - 1);
      if (match) {
        cells.push(
          <div key={code} className="flex flex-col gap-1.5">
            <span className="font-jetbrains text-slate text-[10px] font-bold tracking-[0.14em] uppercase">
              {code}
            </span>
            <PublicMatchCard match={match} teamPoolNumbers={teamPoolNumbers} />
          </div>,
        );
      } else {
        // Not played yet — name the two matches that will feed it.
        // Inverse of deleteMatch's own (r + 1, floor(p / 2)) rule.
        const feederRound = round - 1;
        const outcome = isBronze ? "Loser" : "Winner";
        // The bronze match is fed by BOTH semifinals (their losers), not
        // by the 2p / 2p+1 pair a normal slot inherits.
        const feederPositions: [number, number] = isBronze ? [0, 1] : [position * 2, position * 2 + 1];
        const feeders: [string, string] =
          feederRound < firstRound
            ? ["To be determined", "To be determined"]
            : [
                `${outcome} ${matchCode(feederRound, feederPositions[0], totalRounds - 1)}`,
                `${outcome} ${matchCode(feederRound, feederPositions[1], totalRounds - 1)}`,
              ];
        cells.push(<PlaceholderCard key={code} code={code} feeders={feeders} />);
      }
    }

    columns.push(
      <div key={round} className="flex min-w-[240px] flex-1 flex-col gap-3">
        <h4 className="font-jetbrains text-slate text-[11px] font-bold tracking-[0.18em] uppercase">
          {isFinalRound && hasThirdPlaceMatch ? "Final · Bronze" : roundName(round, totalRounds - 1)}
        </h4>
        {/* Centred within the column so later rounds sit beside the middle
            of the pair that feeds them, the way a drawn bracket reads. */}
        <div className="flex flex-1 flex-col justify-around gap-3">{cells}</div>
      </div>,
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Columns scroll sideways rather than wrapping — a bracket that
          reflows into one column stops reading as a bracket. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max items-stretch gap-4">{columns}</div>
      </div>

      {looseMatches.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="font-jetbrains text-slate text-[11px] font-bold tracking-[0.18em] uppercase">
            Other matches
          </h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {looseMatches.map((match) => (
              <PublicMatchCard key={match.id} match={match} teamPoolNumbers={teamPoolNumbers} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
