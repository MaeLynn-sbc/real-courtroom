import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { playerService } from "@/services/player/player.service";
import { skillTextClass } from "@/types/open-play-skill-color";
import { OPEN_PLAY_SKILL_LEVELS } from "@/types/open-play-skill-levels";

import { PlayerRowActions } from "./player-row-actions";

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
          <TableHead>Phone</TableHead>
          <TableHead>Open play level</TableHead>
          <TableHead>Tournament level</TableHead>
          <TableHead className="text-right">Actions</TableHead>
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
            <TableCell>{player.phone ?? "—"}</TableCell>
            {/* The level walk-in check-in records (owner, 2026-09-17:
                "players tab should save their skill level"). It always
                was saved; this column just never showed it — the old
                single Skill Level column was the tournament level, which
                a walk-in never has. */}
            <TableCell>
              {player.openPlaySkillLevel ? (
                <span className={`font-medium ${skillTextClass(player.openPlaySkillLevel)}`}>
                  {OPEN_PLAY_SKILL_LEVELS[player.openPlaySkillLevel].label}
                </span>
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell>
              {player.skillLevel ? (
                <Badge variant="outline">{SKILL_LEVEL_LABELS[player.skillLevel]}</Badge>
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell className="text-right">
              <PlayerRowActions playerId={player.id} playerName={player.user.name ?? player.user.email ?? "this player"} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
