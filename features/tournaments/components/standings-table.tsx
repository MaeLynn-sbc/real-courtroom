import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RoundRobinStandingRow } from "@/services/tournaments/standings-calculator";
import type { StandingsResult } from "@/services/tournaments/standings.service";

interface StandingsTableProps {
  standings: StandingsResult;
  teamNames: Record<string, string>;
  teamPoolNumbers: Record<string, string | null>;
}

// Owner request (2026-08-15): "can we fix first the standing? can we
// sort it by pool and not the whole roster" — same groupByPool +
// isPooled pattern already used by bracket-view.tsx (and
// public-standings-table.tsx's own copy of this same helper).
function groupByPool(rows: RoundRobinStandingRow[]): Map<string | null, RoundRobinStandingRow[]> {
  const groups = new Map<string | null, RoundRobinStandingRow[]>();
  for (const row of rows) {
    const list = groups.get(row.poolLabel) ?? [];
    list.push(row);
    groups.set(row.poolLabel, list);
  }
  return groups;
}

export function StandingsTable({ standings, teamNames, teamPoolNumbers }: StandingsTableProps) {
  if (standings.rows.length === 0) {
    return <EmptyState title="No standings yet." />;
  }

  if (standings.format === "ROUND_ROBIN") {
    const pools = Array.from(groupByPool(standings.rows).entries()).sort(([a], [b]) =>
      (a ?? "").localeCompare(b ?? ""),
    );
    const isPooled = pools.length > 1 || pools[0]?.[0] !== null;

    return (
      <div className="flex flex-col gap-6">
        {pools.map(([poolLabel, poolRows]) => (
          <div key={poolLabel ?? "none"}>
            {isPooled ? <h3 className="mb-2 text-sm font-semibold">Pool {poolLabel ?? "—"}</h3> : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Played</TableHead>
                  <TableHead>Wins</TableHead>
                  <TableHead>Losses</TableHead>
                  <TableHead>Sets</TableHead>
                  <TableHead>Diff</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {poolRows.map((row) => (
                  <TableRow key={row.teamId}>
                    <TableCell className="font-medium">
                      {teamPoolNumbers[row.teamId] ? (
                        <span className="text-muted-foreground">{teamPoolNumbers[row.teamId]}. </span>
                      ) : null}
                      {teamNames[row.teamId] ?? row.teamId}
                    </TableCell>
                    <TableCell>{row.played}</TableCell>
                    <TableCell>{row.wins}</TableCell>
                    <TableCell>{row.losses}</TableCell>
                    <TableCell>
                      {row.setsWon}–{row.setsLost}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>
                          {row.pointDifferential > 0 ? `+${row.pointDifferential}` : row.pointDifferential}
                        </span>
                        {/* Owner request (2026-08-11): "I don't want a
                            genuine tie to be invisible to me" — this row
                            survived all five USAP tiebreakers and was
                            still tied, ordered arbitrarily by teamId as
                            a last resort. Staff-only — the public table
                            never shows this per row. */}
                        {row.tiedAfterAllTiebreakers ? (
                          <Badge variant="destructive">Tie unresolved</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      </div>
    );
  }

  const STATUS_VARIANTS = {
    CHAMPION: "success",
    ACTIVE: "outline",
    ELIMINATED: "destructive",
  } as const;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Team</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {standings.rows.map((row) => (
          <TableRow key={row.teamId}>
            <TableCell className="font-medium">{teamNames[row.teamId] ?? row.teamId}</TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANTS[row.status]}>
                {row.status === "ELIMINATED" && row.eliminatedInRound
                  ? `Eliminated — Round ${row.eliminatedInRound}`
                  : row.status === "CHAMPION"
                    ? "Champion"
                    : "Active"}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
