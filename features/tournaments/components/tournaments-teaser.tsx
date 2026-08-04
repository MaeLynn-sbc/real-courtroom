import Link from "next/link";

import { standingsService } from "@/services/tournaments/standings.service";
import { tournamentService } from "@/services/tournaments/tournament.service";

// "Put tournaments on the homepage once bracketing is done, with live
// scores and standings" (owner, 2026-08-04). Same "compact teaser + link"
// shape as CoachingTeaser — one card per bracketed CATEGORY (a tournament
// can have several), a one-line status snapshot, full bracket/standings
// live on /tournaments/[id]. Auto-hides entirely once nothing qualifies —
// same as CoachingTeaser when no coach has availability.
function categorySnapshot(standings: Awaited<ReturnType<typeof standingsService.getStandings>>): string {
  if (standings.rows.length === 0) {
    return "Bracket underway";
  }
  if (standings.format === "ROUND_ROBIN") {
    const leader = [...standings.rows].sort((a, b) => b.wins - a.wins)[0];
    return `Leading: ${leader.wins}-${leader.losses}`;
  }
  const champion = standings.rows.find((row) => row.status === "CHAMPION");
  if (champion) {
    return "Champion crowned";
  }
  const stillActive = standings.rows.filter((row) => row.status === "ACTIVE").length;
  return `${stillActive} team${stillActive === 1 ? "" : "s"} still in it`;
}

export async function TournamentsTeaser() {
  const tournaments = await tournamentService.listPublicTournamentsWithBrackets();
  if (tournaments.length === 0) {
    return null;
  }

  const cards = (
    await Promise.all(
      tournaments.map(async (tournament) =>
        Promise.all(
          tournament.categories.map(async (category) => ({
            tournamentId: tournament.id,
            tournamentName: tournament.name,
            categoryId: category.id,
            categoryName: category.name,
            snapshot: categorySnapshot(await standingsService.getStandings(category.id)),
          })),
        ),
      ),
    )
  ).flat();

  if (cards.length === 0) {
    return null;
  }

  // Each card already links to its own tournament — the bottom CTA is
  // only unambiguous when every card points at the SAME tournament
  // (one tournament, several bracketed categories). With more than one
  // tournament live at once, skip it rather than arbitrarily picking one.
  const singleTournamentId = tournaments.length === 1 ? tournaments[0].id : null;

  return (
    <section id="tournaments" className="border-line border-t px-6 py-[clamp(56px,7vw,90px)]">
      <div className="mx-auto max-w-6xl">
        <span className="font-jetbrains text-coral text-[11px] font-bold tracking-[0.22em] uppercase">
          Live bracket
        </span>
        <h2 className="font-display text-bone mt-2 text-[clamp(30px,4.4vw,52px)] leading-[0.94] font-extrabold tracking-[-0.01em] uppercase">
          Tournaments
        </h2>
        <p className="text-slate mt-3 max-w-[52ch] text-sm">
          Live scores and standings from tournaments underway right now.
        </p>

        <div className="mt-8 grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.categoryId}
              href={`/tournaments/${card.tournamentId}`}
              className="border-line bg-navy-800 hover:border-green/45 rounded-2xl border p-6 transition-colors"
            >
              <span className="font-jetbrains text-coral text-[10px] tracking-[0.18em] uppercase">
                {card.tournamentName}
              </span>
              <h3 className="font-display mt-2 text-2xl font-extrabold tracking-[0.01em] uppercase">
                {card.categoryName}
              </h3>
              <p className="text-slate mt-2 text-[14.5px]">{card.snapshot}</p>
            </Link>
          ))}
        </div>

        {singleTournamentId ? (
          <Link
            href={`/tournaments/${singleTournamentId}`}
            className="border-line text-bone hover:border-green mt-6 inline-flex items-center gap-2 rounded-full border px-6 py-3 text-sm font-bold transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
          >
            See live bracket &amp; standings
          </Link>
        ) : null}
      </div>
    </section>
  );
}
