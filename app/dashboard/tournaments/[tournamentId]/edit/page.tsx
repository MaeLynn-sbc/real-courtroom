import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TournamentEditForm } from "@/features/tournaments/components/tournament-edit-form";
import { tournamentService } from "@/services/tournaments/tournament.service";

export const metadata: Metadata = {
  title: "Edit tournament",
};

export const dynamic = "force-dynamic";

// The screen the update service and action were always missing — see
// updateTournamentAction's own comment, "that one has no UI". Until this
// existed a tournament was effectively immutable once created, so a wrong
// date could only be fixed in the database.
export default async function EditTournamentPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;
  const tournament = await tournamentService.getTournamentById(tournamentId);

  if (!tournament || tournament.deletedAt) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit tournament</h1>
        <p className="text-muted-foreground text-sm">
          {tournament.name} · /tournaments/{tournament.slug}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <TournamentEditForm
            tournamentId={tournament.id}
            initial={{
              name: tournament.name,
              description: tournament.description,
              venueInfo: tournament.venueInfo,
              startDate: tournament.startDate,
              endDate: tournament.endDate,
            }}
          />
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        The public URL and the tournament&apos;s status are changed on the tournament page itself —
        a URL change breaks existing links, and status follows its own transition rules, so neither
        is edited by accident here.
      </p>
    </div>
  );
}
