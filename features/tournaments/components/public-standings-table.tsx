import { cn } from "@/lib/utils";
import type { StandingsResult } from "@/services/tournaments/standings.service";

interface PublicStandingsTableProps {
  standings: StandingsResult;
  teamNames: Record<string, string>;
}

// Public counterpart to standings-table.tsx — same StandingsResult shape,
// styled for the branded public site (navy/bone/coral) instead of the
// staff dashboard's generic shadcn Table.
export function PublicStandingsTable({ standings, teamNames }: PublicStandingsTableProps) {
  if (standings.rows.length === 0) {
    return <p className="text-slate text-sm">No standings yet.</p>;
  }

  if (standings.format === "ROUND_ROBIN") {
    return (
      <div className="overflow-x-auto">
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
            {standings.rows.map((row) => (
              <tr key={row.teamId} className="border-line/60 border-b last:border-b-0">
                <td className="text-bone py-2 pr-3 font-medium">
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
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {standings.rows.map((row) => (
        <div
          key={row.teamId}
          className="border-line flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
        >
          <span className="text-bone font-medium">{teamNames[row.teamId] ?? row.teamId}</span>
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
