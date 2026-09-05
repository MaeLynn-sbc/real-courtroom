import type { MatchWithTeams } from "@/features/tournaments/components/match-card";
import { PublicMatchCard } from "@/features/tournaments/components/public-match-card";
import { STAGE_CODES, STAGE_LABELS, STAGE_ORDER } from "@/lib/match-stage";

// The PLAYOFFS block above a category's pool rounds.
//
// Renders from each match's ASSIGNED stage rather than from bracket
// position — the whole point of the stage column. The organiser decides
// after the pools finish whether there are quarterfinals, and a
// round-robin category has no bracket geometry to derive them from
// anyway.
//
// Deliberately reuses PublicMatchCard rather than drawing its own rows:
// scores, winner emphasis, team labels and pool numbers then look
// identical to every other match on the page, and there is one card to
// maintain instead of two that drift.
//
// Only stages that actually have matches get a column, so a four-team
// playoff shows Semifinals and Final with no empty Quarterfinals heading
// beside them.
export function PublicPlayoffSection({
  matches,
  teamPoolNumbers,
}: {
  matches: MatchWithTeams[];
  teamPoolNumbers: Record<string, string | null>;
}) {
  const byStage = STAGE_ORDER.map((stage) => ({
    stage,
    matches: matches.filter((match) => match.stage === stage),
  })).filter((group) => group.matches.length > 0);

  if (byStage.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <span className="bg-green text-navy-900 rounded px-2 py-0.5 text-xs font-bold tracking-widest uppercase">
          Playoffs
        </span>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {byStage.map((group) => (
          <div key={group.stage} className="flex flex-col gap-2">
            <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
              {STAGE_LABELS[group.stage]}
              {group.matches.length > 1 ? "s" : ""}
            </p>
            {group.matches.map((match, index) => (
              <div key={match.id} className="flex flex-col gap-1">
                {/* SF1 / SF2 when a stage has more than one match; a bare
                    code otherwise, since a lone final is "FINALS", not
                    "FINALS1". */}
                <span className="text-muted-foreground font-mono text-[10px] font-semibold tracking-widest">
                  {group.matches.length > 1
                    ? `${STAGE_CODES[group.stage]}${index + 1}`
                    : STAGE_CODES[group.stage]}
                </span>
                <PublicMatchCard match={match} teamPoolNumbers={teamPoolNumbers} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
