import Link from "next/link";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TournamentStatusBadge } from "@/features/tournaments/components/tournament-status-badge";
import type { tournamentService } from "@/services/tournaments/tournament.service";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

type Tournaments = Awaited<ReturnType<typeof tournamentService.listTournaments>>;

interface TournamentListProps {
  tournaments: Tournaments;
}

export function TournamentList({ tournaments }: TournamentListProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Dates</TableHead>
          <TableHead>Venue</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tournaments.map((tournament) => (
          <TableRow key={tournament.id}>
            <TableCell>
              <Link href={`/dashboard/tournaments/${tournament.id}`} className="font-medium hover:underline">
                {tournament.name}
              </Link>
            </TableCell>
            <TableCell>
              {dateFormatter.format(tournament.startDate)} – {dateFormatter.format(tournament.endDate)}
            </TableCell>
            <TableCell>{tournament.venueInfo ?? "—"}</TableCell>
            <TableCell>
              <TournamentStatusBadge status={tournament.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
