import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { StandingsResult } from "@/services/tournaments/standings.service";

interface StandingsTableProps {
  standings: StandingsResult;
  teamNames: Record<string, string>;
  teamPoolNumbers: Record<string, string | null>;
}

export function StandingsTable({ standings, teamNames, teamPoolNumbers }: StandingsTableProps) {
  if (standings.rows.length === 0) {
    return <EmptyState title="No standings yet." />;
  }

  if (standings.format === "ROUND_ROBIN") {
    return (
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
          {standings.rows.map((row) => (
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
                  <span>{row.pointDifferential > 0 ? `+${row.pointDifferential}` : row.pointDifferential}</span>
                  {/* Owner request (2026-08-11): "I don't want a genuine
                      tie to be invisible to me" — this row survived all
                      five USAP tiebreakers and was still tied, ordered
                      arbitrarily by teamId as a last resort. Staff-only —
                      the public table never shows this per row. */}
                  {row.tiedAfterAllTiebreakers ? (
                    <Badge variant="destructive">Tie unresolved</Badge>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
