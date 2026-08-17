import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PublicBracketView } from "@/features/tournaments/components/public-bracket-view";
import { PublicStandingsTable } from "@/features/tournaments/components/public-standings-table";
import { formatTeamPoolNumber } from "@/services/tournaments/bracket-generator";
import { matchService } from "@/services/tournaments/match.service";
import { standingsService } from "@/services/tournaments/standings.service";
import { tournamentService } from "@/services/tournaments/tournament.service";

export const dynamic = "force-dynamic";

const FORMAT_LABELS: Record<string, string> = {
  ROUND_ROBIN: "Round Robin",
  SINGLE_ELIMINATION: "Single Elimination",
  DOUBLE_ELIMINATION: "Double Elimination",
  POOL_PLAY: "Pool Play",
};

const dateFormatter = new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric" });

function formatDateRange(startDate: Date, endDate: Date): string {
  const start = dateFormatter.format(startDate);
  const end = dateFormatter.format(endDate);
  return start === end ? start : `${start} – ${end}`;
}

interface TournamentPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: TournamentPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tournament = await tournamentService.getTournamentBySlugOrId(slug);
  // Bail HERE, not only in the component below. This page is
  // force-dynamic, so once metadata resolves successfully Next has already
  // committed a 200 and started streaming — a later notFound() then renders
  // the not-found page under a 200 (a "soft 404"). Verified against
  // production: /tournaments/<unknown> returned 200 while a genuinely
  // unrouted path returned a real 404. Public tournament URLs get shared
  // and crawled, so an unknown one has to answer 404 properly.
  if (!tournament || tournament.deletedAt || tournament.status === "DRAFT") {
    notFound();
  }
  return { title: `${tournament.name} — The Courtroom` };
}

// Public, no login. Bracketing-is-done gate (owner, 2026-08-04): a
// category with no matches yet has nothing to show here — it's simply
// omitted, not shown as an empty bracket. Mirrors
// listPublicTournamentsWithBrackets' own filter, applied per-category
// here since a single tournament can have a mix (one category bracketed,
// another still in registration).
export default async function PublicTournamentPage({ params }: TournamentPageProps) {
  const { slug } = await params;
  // Resolves the readable slug, and still accepts a bare cuid so links
  // shared before migration 74 keep working — see getTournamentBySlugOrId.
  const tournament = await tournamentService.getTournamentBySlugOrId(slug);
  if (!tournament || tournament.deletedAt || tournament.status === "DRAFT") {
    notFound();
  }

  const bracketedCategories = tournament.categories.filter((category) => category._count.matches > 0);

  const categoryData = await Promise.all(
    bracketedCategories.map(async (category) => {
      const [fullCategory, matches, standings] = await Promise.all([
        tournamentService.getCategoryById(category.id),
        matchService.listMatchesByCategory(category.id),
        standingsService.getStandings(category.id),
      ]);
      const teamNames: Record<string, string> = {};
      const teamPoolNumbers: Record<string, string | null> = {};
      for (const registration of fullCategory?.registrations ?? []) {
        const player1Name = registration.team.player1.user.name ?? "Unknown player";
        const player2 = registration.team.player2;
        teamNames[registration.teamId] = player2
          ? `${player1Name} / ${player2.user.name ?? "Unknown player"}`
          : player1Name;
        teamPoolNumbers[registration.teamId] = formatTeamPoolNumber(
          registration.poolLabel,
          registration.poolPosition,
        );
      }
      return { category, matches, standings, teamNames, teamPoolNumbers };
    }),
  );

  return (
    <div className="bg-navy-900 flex min-h-svh flex-1 flex-col">
      <SiteHeader />

      <section className="border-line border-t px-6 py-[clamp(40px,6vw,72px)]">
        <div className="mx-auto max-w-5xl">
          <span className="font-jetbrains text-green text-[11px] font-bold tracking-[0.22em] uppercase">
            {formatDateRange(tournament.startDate, tournament.endDate)}
          </span>
          <h1 className="font-display text-bone mt-2 text-[clamp(36px,6vw,64px)] leading-[0.95] font-extrabold tracking-[-0.01em] uppercase">
            {tournament.name}
          </h1>
          {tournament.venueInfo ? <p className="text-slate mt-2 text-sm">{tournament.venueInfo}</p> : null}
          {tournament.description ? (
            <p className="text-slate mt-4 max-w-[60ch] text-sm">{tournament.description}</p>
          ) : null}
        </div>
      </section>

      {categoryData.length === 0 ? (
        <section className="px-6 py-16">
          <div className="mx-auto max-w-5xl">
            <p className="text-slate text-sm">
              Brackets haven&apos;t been generated yet — check back once the tournament gets underway.
            </p>
          </div>
        </section>
      ) : (
        categoryData.map(({ category, matches, standings, teamNames, teamPoolNumbers }) => (
          <section key={category.id} className="border-line border-t px-6 py-[clamp(32px,5vw,56px)]">
            <div className="mx-auto max-w-5xl">
              <h2 className="font-display text-bone text-2xl font-extrabold tracking-[-0.01em] uppercase">
                {category.name}
              </h2>
              <p className="font-jetbrains text-slate mt-1 text-[11px] tracking-[0.14em] uppercase">
                {FORMAT_LABELS[category.format] ?? category.format}
              </p>

              <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr]">
                <div>
                  <h3 className="font-jetbrains text-slate mb-3 text-[11px] font-bold tracking-[0.18em] uppercase">
                    Bracket
                  </h3>
                  <PublicBracketView
                    matches={matches}
                    teamPoolNumbers={teamPoolNumbers}
                    format={category.format}
                  />
                </div>
                <div>
                  <h3 className="font-jetbrains text-slate mb-3 text-[11px] font-bold tracking-[0.18em] uppercase">
                    Standings
                  </h3>
                  <PublicStandingsTable
                    standings={standings}
                    teamNames={teamNames}
                    teamPoolNumbers={teamPoolNumbers}
                  />
                </div>
              </div>
            </div>
          </section>
        ))
      )}

      <SiteFooter />
    </div>
  );
}
