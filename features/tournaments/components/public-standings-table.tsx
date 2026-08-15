import { cn } from "@/lib/utils";
import { TIEBREAKER_ORDER_DESCRIPTION, type RoundRobinStandingRow } from "@/services/tournaments/standings-calculator";
import type { StandingsResult } from "@/services/tournaments/standings.service";

interface PublicStandingsTableProps {
  standings: StandingsResult;
  teamNames: Record<string, string>;
  teamPoolNumbers: Record<string, string | null>;
}

// Owner request (2026-08-15): "can we fix first the standing? can we
// sort it by pool and not the whole roster" — same groupByPool +
// isPooled pattern already used by bracket-view.tsx/
// public-bracket-view.tsx, applied here so a pooled category renders
// one small table per pool instead of one long roster-wide list.
function groupByPool(rows: RoundRobinStandingRow[]): Map<string | null, RoundRobinStandingRow[]> {
  const groups = new Map<string | null, RoundRobinStandingRow[]>();
  for (const row of rows) {
    const list = groups.get(row.poolLabel) ?? [];
    list.push(row);
    groups.set(row.poolLabel, list);
  }
  return groups;
}

// Public counterpart to standings-table.tsx — same StandingsResult shape,
// styled for the branded public site (navy/bone/coral) instead of the
// staff dashboard's generic shadcn Table.
export function PublicStandingsTable({ standings, teamNames, teamPoolNumbers }: PublicStandingsTableProps) {
  if (standings.rows.length === 0) {
    return <p className="text-slate text-sm">No standings yet.</p>;
  }

  if (standings.format === "ROUND_ROBIN") {
    const pools = Array.from(groupByPool(standings.rows).entries()).sort(([a], [b]) =>
      (a ?? "").localeCompare(b ?? ""),
    );
    const isPooled = pools.length > 1 || pools[0]?.[0] !== null;

    return (
      <div className="flex flex-col gap-6">
        {pools.map(([poolLabel, poolRows]) => (
          <div key={poolLabel ?? "none"} className="overflow-x-auto">
            {isPooled ? <h3 className="text-bone mb-2 text-sm font-semibold">Pool {poolLabel ?? "—"}</h3> : null}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-line text-slate border-b text-left text-xs uppercase">
                  <th className="py-2 pr-3 font-medium">Team</th>
                  <th className="px-3 py-2 font-medium">P</th>
                  <th className="px-3 py-2 font-medium">W</th>
                  <th className="px-3 py-2 font-medium">L</th>
                  <th className="px-3 py-2 font-medium">Sets</th>
                  <th className="px-3 py-2 font-medium">Diff</th>
                </tr>
              </thead>
              <tbody>
                {poolRows.map((row) => (
                  <tr key={row.teamId} className="border-line/60 border-b last:border-b-0">
                    <td className="text-bone py-2 pr-3 font-medium">
                      {teamPoolNumbers[row.teamId] ? (
                        <span className="text-slate">{teamPoolNumbers[row.teamId]}. </span>
                      ) : null}
                      {teamNames[row.teamId] ?? row.teamId}
                    </td>
                    <td className="text-slate px-3 py-2">{row.played}</td>
                    <td className="text-slate px-3 py-2">{row.wins}</td>
                    <td className="text-slate px-3 py-2">{row.losses}</td>
                    <td className="text-slate px-3 py-2">
                      {row.setsWon}–{row.setsLost}
                    </td>
                    <td className="text-slate px-3 py-2">
                      {row.pointDifferential > 0 ? `+${row.pointDifferential}` : row.pointDifferential}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {/* Owner request (2026-08-11): "the public standings page must
            display the tiebreaker order in use, so players can see how
            placement was decided." Short, plain text — same order
            standings-calculator.ts's cascade actually implements. */}
        <p className="text-slate text-xs">
          Ties are broken in order: {TIEBREAKER_ORDER_DESCRIPTION.join(", then ")}.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {standings.rows.map((row) => (
        <div
          key={row.teamId}
          className="border-line flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
        >
          <span className="text-bone font-medium">
            {teamPoolNumbers[row.teamId] ? (
              <span className="text-slate">{teamPoolNumbers[row.teamId]}. </span>
            ) : null}
            {teamNames[row.teamId] ?? row.teamId}
          </span>
          <span
            className={cn(
              "font-jetbrains rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] uppercase",
              row.status === "CHAMPION" && "bg-green/15 text-green",
              row.status === "ACTIVE" && "bg-slate/15 text-slate",
              row.status === "ELIMINATED" && "bg-coral/15 text-coral",
            )}
          >
            {row.status === "ELIMINATED" && row.eliminatedInRound
              ? `Out — Round ${row.eliminatedInRound}`
              : row.status === "CHAMPION"
                ? "Champion"
                : "Active"}
          </span>
        </div>
      ))}
    </div>
  );
}
