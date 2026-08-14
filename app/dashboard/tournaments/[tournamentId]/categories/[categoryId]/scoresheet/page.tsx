import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ScoresheetView } from "@/features/tournaments/components/scoresheet-view";
import { courtService } from "@/services/court/court.service";
import { tournamentDisplayService } from "@/services/display/tournament-display.service";
import { formatTeamPoolNumber } from "@/services/tournaments/bracket-generator";
import { matchService } from "@/services/tournaments/match.service";
import { tournamentService } from "@/services/tournaments/tournament.service";

interface ScoresheetPageProps {
  params: Promise<{ tournamentId: string; categoryId: string }>;
}

export async function generateMetadata({ params }: ScoresheetPageProps): Promise<Metadata> {
  const { categoryId } = await params;
  const category = await tournamentService.getCategoryById(categoryId);
  return { title: category ? `${category.name} — Scoresheet` : "Scoresheet" };
}

function teamLabel(team: { player1: { user: { name: string | null; email: string | null } }; player2: { user: { name: string | null; email: string | null } } | null } | null): string {
  if (!team) {
    return "BYE";
  }
  const player1Name = team.player1.user.name ?? team.player1.user.email ?? "Unknown player";
  if (!team.player2) {
    return player1Name;
  }
  return `${player1Name} / ${team.player2.user.name ?? team.player2.user.email ?? "Unknown player"}`;
}

// Owner request (2026-08-11): "i want the scheduled match to be
// separated at the scoresheets... it should be a different tab" —
// SCHEDULED-only (not in-progress/completed) so a court official
// carrying a printed sheet sees only what's actually still coming up,
// not the whole category's history mixed in. A real, separate page
// (opened in its own tab from the category page), not a section on
// the busy staff-editing view, specifically so it prints clean.
export default async function ScoresheetPage({ params }: ScoresheetPageProps) {
  const { tournamentId, categoryId } = await params;

  const category = await tournamentService.getCategoryById(categoryId);
  if (!category) {
    notFound();
  }

  const [allMatches, courts, displayData] = await Promise.all([
    matchService.listMatchesByCategory(categoryId),
    courtService.listCourts(),
    tournamentDisplayService.getDisplayData(),
  ]);

  // Owner request (2026-08-15): "remove the court 1 if it is filled
  // already" — a court is "filled" once it has a current match (playing
  // now or up next in its queue, i.e. displayData's own matches[0]
  // concept), tracked by which match currently occupies it so a row can
  // still show ITS OWN court as a live option, just not another match's.
  const occupyingMatchIdByCourtName = new Map(
    displayData.courts
      .filter((court) => court.matches.length > 0)
      .map((court) => [court.courtName, court.matches[0]!.id]),
  );

  // Owner report (2026-08-15): "next up and others are not filtered out
  // after using it and clicking on save" — each staging slot (like a
  // court) can only ever hold one match at a time on the TV's own Next
  // up/After that/Then row, so it needs the exact same "hide from other
  // rows, keep visible on the one that owns it" filtering as courts.
  // displayData.staged is already ordered NEXT_UP/AFTER_THAT/THEN with
  // at most the first match per slot ever shown on the TV (see
  // tournament-display.service.ts's own sort), so the first match seen
  // per slot here is exactly the one that "owns" it.
  const occupyingMatchIdByStagedSlot = new Map<string, string>();
  for (const match of displayData.staged) {
    if (match.stagedSlot && !occupyingMatchIdByStagedSlot.has(match.stagedSlot)) {
      occupyingMatchIdByStagedSlot.set(match.stagedSlot, match.id);
    }
  }

  // Owner request (2026-08-12): "can the team has numbers. like what
  // number they are in the pool or bracket" — a court official reading
  // this printed sheet should be able to tell teams apart by number,
  // same as every other tournament surface.
  const teamPoolNumbers: Record<string, string | null> = {};
  for (const registration of category.registrations) {
    teamPoolNumbers[registration.teamId] = formatTeamPoolNumber(
      registration.poolLabel,
      registration.poolPosition,
    );
  }
  function withNumber(team: Parameters<typeof teamLabel>[0], teamId: string | null): string {
    const label = teamLabel(team);
    const number = teamId ? teamPoolNumbers[teamId] : null;
    return number ? `${number}. ${label}` : label;
  }

  const scheduledMatches = allMatches
    .filter((match) => match.status === "SCHEDULED")
    .map((match) => ({
      id: match.id,
      poolLabel: match.poolLabel,
      round: match.round,
      team1Name: withNumber(match.team1, match.team1Id),
      team2Name: withNumber(match.team2, match.team2Id),
      courtId: match.courtId,
      courtName: match.court?.name ?? null,
      stagedSlot: match.stagedSlot,
    }));
  const courtOptions = courts
    .filter((court) => court.status !== "DISABLED")
    .map((court) => ({
      id: court.id,
      name: court.name,
      occupiedByMatchId: occupyingMatchIdByCourtName.get(court.name) ?? null,
    }));

  return (
    <ScoresheetView
      tournamentId={tournamentId}
      categoryId={categoryId}
      categoryName={category.name}
      tournamentName={category.tournament.name}
      matches={scheduledMatches}
      courts={courtOptions}
      stageOptions={[
        { value: "NEXT_UP", label: "Next up", occupiedByMatchId: occupyingMatchIdByStagedSlot.get("NEXT_UP") ?? null },
        {
          value: "AFTER_THAT",
          label: "After that",
          occupiedByMatchId: occupyingMatchIdByStagedSlot.get("AFTER_THAT") ?? null,
        },
        { value: "THEN", label: "Then", occupiedByMatchId: occupyingMatchIdByStagedSlot.get("THEN") ?? null },
      ]}
    />
  );
}
