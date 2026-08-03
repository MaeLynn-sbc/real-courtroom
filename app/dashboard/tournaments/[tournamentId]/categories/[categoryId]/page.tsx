import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BracketView } from "@/features/tournaments/components/bracket-view";
import { GenerateBracketButton } from "@/features/tournaments/components/generate-bracket-button";
import { MaxTeamsField } from "@/features/tournaments/components/max-teams-field";
import { RegistrationForm } from "@/features/tournaments/components/registration-form";
import { RegistrationList } from "@/features/tournaments/components/registration-list";
import { StandingsTable } from "@/features/tournaments/components/standings-table";
import { MODULE_KEYS } from "@/lib/module-flags";
import { courtService } from "@/services/court/court.service";
import { playerService } from "@/services/player/player.service";
import { saleService } from "@/services/sales/sale.service";
import { settingsService } from "@/services/settings/settings.service";
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

  const [matches, standings, players, courts, paymentMethods, enabledModules] = await Promise.all([
    matchService.listMatchesByCategory(categoryId),
    standingsService.getStandings(categoryId),
    playerService.listPlayers(),
    courtService.listCourts(),
    saleService.listPaymentMethods(),
    settingsService.getEnabledModules(),
  ]);
  const tournamentRegistrationEnabled = enabledModules[MODULE_KEYS.TOURNAMENT_REGISTRATION];

  const playerOptions = players.map((player) => ({
    id: player.id,
    label: player.user.name ?? player.user.email ?? "Unknown player",
  }));

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

  const bracketGenerated = matches.length > 0;
  const confirmedCount = category.registrations.filter((r) => r.status === "CONFIRMED").length;

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
          />
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Register a team</h2>
          {tournamentRegistrationEnabled ? (
            <RegistrationForm
              tournamentId={tournamentId}
              categoryId={categoryId}
              players={playerOptions}
              paymentMethods={paymentMethodOptions}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              Tournament registration is currently unavailable.
            </p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium">Bracket</h2>
          {!bracketGenerated ? (
            <GenerateBracketButton tournamentId={tournamentId} categoryId={categoryId} />
          ) : null}
        </div>
        {!bracketGenerated ? (
          <p className="text-muted-foreground text-sm">
            {confirmedCount} confirmed team{confirmedCount === 1 ? "" : "s"} — at least 2 are
            required to generate the bracket.
          </p>
        ) : null}
        <BracketView
          tournamentId={tournamentId}
          categoryId={categoryId}
          matches={matches}
          courts={courtOptions}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Standings</h2>
        <StandingsTable standings={standings} teamNames={teamNames} />
      </section>
    </div>
  );
}
