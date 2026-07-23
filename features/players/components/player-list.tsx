import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { playerService } from "@/services/player/player.service";

const SKILL_LEVEL_LABELS: Record<string, string> = {
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
  PRO: "Pro",
};

type Players = Awaited<ReturnType<typeof playerService.listPlayers>>;

interface PlayerListProps {
  players: Players;
}

export function PlayerList({ players }: PlayerListProps) {
  if (players.length === 0) {
    return <p className="text-muted-foreground text-sm">No players found.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Skill Level</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {players.map((player) => (
          <TableRow key={player.id}>
            <TableCell>
              <Link href={`/dashboard/players/${player.id}`} className="font-medium hover:underline">
                {player.user.name ?? player.user.email}
              </Link>
            </TableCell>
            <TableCell>{player.user.email}</TableCell>
            <TableCell>
              {player.skillLevel ? (
                <Badge variant="outline">{SKILL_LEVEL_LABELS[player.skillLevel]}</Badge>
              ) : (
                "—"
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
