import { PlusCircle, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { PlayerList } from "@/features/players/components/player-list";
import { PlayerSearchFilters } from "@/features/players/components/player-search-filters";
import type { SkillLevel } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { PLAYER_GROUPS, type PlayerGroup } from "@/services/player/player-group";
import { playerService } from "@/services/player/player.service";

export const metadata: Metadata = {
  title: "Players",
};

const SKILL_LEVELS: SkillLevel[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "PRO"];

interface PlayersPageProps {
  searchParams: Promise<{ query?: string; skillLevel?: string; group?: string }>;
}

const GROUP_LABELS: Record<PlayerGroup, string> = {
  regulars: "Regulars",
  tournament: "Tournament only",
  all: "All",
};

export default async function PlayersPage({ searchParams }: PlayersPageProps) {
  const { query, skillLevel: skillLevelParam, group: groupParam } = await searchParams;
  const skillLevel = SKILL_LEVELS.find((level) => level === skillLevelParam);
  // Regulars by default (owner, 2026-09-17): most tournament entrants
  // never come back, so they live under their own tab.
  const group = PLAYER_GROUPS.find((g) => g === groupParam) ?? "regulars";

  const [players, counts] = await Promise.all([
    query || skillLevel
      ? playerService.searchPlayers({ query, skillLevel }, group)
      : playerService.listPlayers(group),
    playerService.countPlayersByGroup(),
  ]);

  const groupHref = (g: PlayerGroup) => {
    const params = new URLSearchParams();
    if (g !== "regulars") params.set("group", g);
    if (query) params.set("query", query);
    if (skillLevel) params.set("skillLevel", skillLevel);
    const qs = params.toString();
    return qs ? `/dashboard/players?${qs}` : "/dashboard/players";
  };

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

      <nav className="flex flex-wrap gap-2" aria-label="Player groups">
        {PLAYER_GROUPS.map((g) => (
          <Link
            key={g}
            href={groupHref(g)}
            aria-current={g === group ? "page" : undefined}
            className={cn(buttonVariants({ variant: g === group ? "default" : "outline", size: "sm" }))}
          >
            {GROUP_LABELS[g]} <span className="tabular-nums opacity-70">{counts[g]}</span>
          </Link>
        ))}
      </nav>
      {group === "tournament" ? (
        <p className="text-muted-foreground -mt-3 text-sm">
          Players who have only ever played a tournament here. They move to Regulars on their own once they
          check in for open play, book a court, take a coach or buy a membership.
        </p>
      ) : null}

      <PlayerSearchFilters query={query} skillLevel={skillLevel} group={group === "regulars" ? undefined : group} />

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
