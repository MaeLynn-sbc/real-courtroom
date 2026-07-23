import { PlusCircle, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { TournamentList } from "@/features/tournaments/components/tournament-list";
import { tournamentService } from "@/services/tournaments/tournament.service";

export const metadata: Metadata = {
  title: "Tournaments",
};

interface TournamentsPageProps {
  searchParams: Promise<{ view?: string }>;
}

export default async function TournamentsPage({ searchParams }: TournamentsPageProps) {
  const { view } = await searchParams;
  const isHistory = view === "history";

  const tournaments = isHistory
    ? await tournamentService.listTournamentHistory()
    : await tournamentService.listTournaments();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tournaments</h1>
          <p className="text-muted-foreground text-sm">
            Manage tournaments, categories, brackets, and standings.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={isHistory ? "/dashboard/tournaments" : "/dashboard/tournaments?view=history"}
            className={buttonVariants({ variant: "outline" })}
          >
            {isHistory ? "Active" : "History"}
          </Link>
          <Link href="/dashboard/tournaments/new" className={buttonVariants()}>
            <PlusCircle className="size-4" aria-hidden="true" />
            New tournament
          </Link>
        </div>
      </div>

      {tournaments.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={isHistory ? "No past tournaments" : "No tournaments yet"}
          description={
            isHistory
              ? "Completed or cancelled tournaments will show up here."
              : "Create a tournament to start adding categories and registering teams."
          }
        />
      ) : (
        <TournamentList tournaments={tournaments} />
      )}
    </div>
  );
}
