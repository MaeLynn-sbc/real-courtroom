import { PlusCircle, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { PlayerList } from "@/features/players/components/player-list";
import { PlayerSearchFilters } from "@/features/players/components/player-search-filters";
import type { SkillLevel } from "@/lib/generated/prisma/enums";
import { playerService } from "@/services/player/player.service";

export const metadata: Metadata = {
  title: "Players",
};

const SKILL_LEVELS: SkillLevel[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "PRO"];

interface PlayersPageProps {
  searchParams: Promise<{ query?: string; skillLevel?: string }>;
}

export default async function PlayersPage({ searchParams }: PlayersPageProps) {
  const { query, skillLevel: skillLevelParam } = await searchParams;
  const skillLevel = SKILL_LEVELS.find((level) => level === skillLevelParam);

  const players =
    query || skillLevel
      ? await playerService.searchPlayers({ query, skillLevel })
      : await playerService.listPlayers();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Players</h1>
          <p className="text-muted-foreground text-sm">
            Manage player profiles, statistics, and membership status.
          </p>
        </div>
        <Link href="/dashboard/players/new" className={buttonVariants()}>
          <PlusCircle className="size-4" aria-hidden="true" />
          New player
        </Link>
      </div>

      <PlayerSearchFilters query={query} skillLevel={skillLevel} />

      {players.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No players found"
          description="Create a player profile or adjust your search."
        />
      ) : (
        <PlayerList players={players} />
      )}
    </div>
  );
}
