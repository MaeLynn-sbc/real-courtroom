import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ScoresheetView } from "@/features/tournaments/components/scoresheet-view";
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

  const allMatches = await matchService.listMatchesByCategory(categoryId);
  const scheduledMatches = allMatches
    .filter((match) => match.status === "SCHEDULED")
    .map((match) => ({
      id: match.id,
      poolLabel: match.poolLabel,
      round: match.round,
      team1Name: teamLabel(match.team1),
      team2Name: teamLabel(match.team2),
      courtName: match.court?.name ?? null,
      scheduledAt: match.scheduledAt ? match.scheduledAt.toISOString() : null,
    }));

  return (
    <ScoresheetView
      tournamentId={tournamentId}
      categoryId={categoryId}
      categoryName={category.name}
      tournamentName={category.tournament.name}
      matches={scheduledMatches}
    />
  );
}
