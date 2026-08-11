import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BracketView } from "@/features/tournaments/components/bracket-view";
import {
  GenerateBracketButton,
  ResetBracketButton,
} from "@/features/tournaments/components/generate-bracket-button";
import { ManualMatchForm } from "@/features/tournaments/components/manual-match-form";
import { MaxTeamsField } from "@/features/tournaments/components/max-teams-field";
import { PoolAssignmentForm } from "@/features/tournaments/components/pool-assignment-form";
import { RegistrationForm } from "@/features/tournaments/components/registration-form";
import { RegistrationList } from "@/features/tournaments/components/registration-list";
import { StandingsTable } from "@/features/tournaments/components/standings-table";
import { courtService } from "@/services/court/court.service";
import { saleService } from "@/services/sales/sale.service";
import { matchService } from "@/services/tournaments/match.service";
import { standingsService } from "@/services/tournaments/standings.service";
import { tournamentService } from "@/services/tournaments/tournament.service";

const FORMAT_LABELS: Record<string, string> = {
  ROUND_ROBIN: "Round Robin",
  SINGLE_ELIMINATION: "Single Elimination",
  DOUBLE_ELIMINATION: "Double Elimination",
  POOL_PLAY: "Pool Play",
};

interface CategoryDetailPageProps {
  params: Promise<{ tournamentId: string; categoryId: string }>;
}

export async function generateMetadata({ params }: CategoryDetailPageProps): Promise<Metadata> {
  const { categoryId } = await params;
  const category = await tournamentService.getCategoryById(categoryId);
  return { title: category?.name ?? "Category" };
}

export default async function CategoryDetailPage({ params }: CategoryDetailPageProps) {
  const { tournamentId, categoryId } = await params;

  const category = await tournamentService.getCategoryById(categoryId);
  if (!category) {
    notFound();
  }

  const [matches, standings, courts, paymentMethods] = await Promise.all([
    matchService.listMatchesByCategory(categoryId),
    standingsService.getStandings(categoryId),
    courtService.listCourts(),
    saleService.listPaymentMethods(),
  ]);

  const paymentMethodOptions = paymentMethods.map((method) => ({
    id: method.id,
    label: method.label,
  }));

  const courtOptions = courts
    .filter((court) => court.status !== "DISABLED")
    .map((court) => ({ id: court.id, name: court.name }));

  const teamNames: Record<string, string> = {};
  for (const registration of category.registrations) {
    const player1Name =
      registration.team.player1.user.name ??
      registration.team.player1.user.email ??
      "Unknown player";
    const player2 = registration.team.player2;
    teamNames[registration.teamId] = player2
      ? `${player1Name} / ${player2.user.name ?? player2.user.email ?? "Unknown player"}`
      : player1Name;
  }

  const confirmedTeams = category.registrations
    .filter((registration) => registration.status === "CONFIRMED")
    .map((registration) => ({ teamId: registration.teamId, name: teamNames[registration.teamId] }));

  const confirmedTeamsWithPool = category.registrations
    .filter((registration) => registration.status === "CONFIRMED")
    .map((registration) => ({
      teamId: registration.teamId,
      name: teamNames[registration.teamId],
      poolLabel: registration.poolLabel,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const poolsByLabel = new Map<string, string[]>();
  for (const registration of category.registrations) {
    if (registration.status !== "CONFIRMED" || !registration.poolLabel) continue;
    const list = poolsByLabel.get(registration.poolLabel) ?? [];
    list.push(teamNames[registration.teamId]);
    poolsByLabel.set(registration.poolLabel, list);
  }
  const pools = Array.from(poolsByLabel.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([poolLabel, teamNamesInPool]) => ({ poolLabel, teamNames: teamNamesInPool }));

  const bracketGenerated = matches.length > 0;
  const confirmedCount = category.registrations.filter((r) => r.status === "CONFIRMED").length;
  const isRoundRobin = category.format === "ROUND_ROBIN";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{category.name}</h1>
        <p className="text-muted-foreground text-sm">
          {category.tournament.name} · {FORMAT_LABELS[category.format] ?? category.format}
        </p>
        <div className="mt-3">
          <MaxTeamsField
            tournamentId={tournamentId}
            categoryId={categoryId}
            maxTeams={category.maxTeams}
            confirmedCount={confirmedCount}
          />
        </div>
      </div>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Registrations</h2>
          <RegistrationList
            tournamentId={tournamentId}
            categoryId={categoryId}
            registrations={category.registrations}
            bracketGenerated={bracketGenerated}
          />
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Register a team</h2>
          <RegistrationForm
            tournamentId={tournamentId}
            categoryId={categoryId}
            paymentMethods={paymentMethodOptions}
            collectsPaymentOnSite={category.tournament.collectsPaymentOnSite}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium">{isRoundRobin ? "Matches" : "Bracket"}</h2>
          <div className="flex items-center gap-4">
            <Link
              href={`/dashboard/tournaments/${tournamentId}/categories/${categoryId}/scoresheet`}
              target="_blank"
              className="text-primary text-sm underline underline-offset-2"
            >
              Scoresheet ↗
            </Link>
            {!bracketGenerated ? (
              <GenerateBracketButton
                tournamentId={tournamentId}
                categoryId={categoryId}
                isRoundRobin={isRoundRobin}
              />
            ) : (
              <ResetBracketButton
                tournamentId={tournamentId}
                categoryId={categoryId}
                isRoundRobin={isRoundRobin}
              />
            )}
          </div>
        </div>
        {!bracketGenerated ? (
          <p className="text-muted-foreground text-sm">
            {confirmedCount} confirmed team{confirmedCount === 1 ? "" : "s"} — at least 2 are
            required to {isRoundRobin ? "create the matchups" : "generate the bracket"}.
            {isRoundRobin ? " Score entry for each match appears here once matchups are created." : ""}
          </p>
        ) : null}
        {!bracketGenerated && isRoundRobin ? (
          <PoolAssignmentForm
            tournamentId={tournamentId}
            categoryId={categoryId}
            confirmedCount={confirmedCount}
            pools={pools}
            teams={confirmedTeamsWithPool}
          />
        ) : null}
        <BracketView
          tournamentId={tournamentId}
          categoryId={categoryId}
          matches={matches}
          courts={courtOptions}
        />
        <ManualMatchForm tournamentId={tournamentId} categoryId={categoryId} teams={confirmedTeams} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Standings</h2>
        <StandingsTable standings={standings} teamNames={teamNames} />
      </section>
    </div>
  );
}
