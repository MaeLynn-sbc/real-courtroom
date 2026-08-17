import { ChevronDown } from "lucide-react";
import Link from "next/link";

import { standingsService } from "@/services/tournaments/standings.service";
import { tournamentService } from "@/services/tournaments/tournament.service";

// "Put tournaments on the homepage once bracketing is done, with live
// scores and standings" (owner, 2026-08-04). Same "compact teaser + link"
// shape as CoachingTeaser — full bracket/standings live on
// /tournaments/[id]. Auto-hides entirely once nothing qualifies — same as
// CoachingTeaser when no coach has availability.
//
// Owner request (2026-08-17): this used to render one card per bracketed
// CATEGORY, flattened across every tournament. The Sayans and Friends
// tournament had 9 bracketed categories, so the homepage showed 9 cards
// that each repeated the same tournament name — on mobile (one column)
// that was nine full-width blocks, swallowing the entire viewport. Now
// it's one collapsed row per TOURNAMENT that expands to reveal its
// categories, so the section costs one row per tournament at rest.
//
// Deliberately a native <details> rather than a client component with
// useState: this stays a server component with zero JS shipped, the
// disclosure works before hydration, and it matches the <details> already
// used in tabs-panel.tsx and both reconciliation workspaces.
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

// Enough to tell the tournaments apart while collapsed, without the row
// growing to the height the old flat grid had.
function categoryPreview(names: string[]): string {
  if (names.length <= 3) {
    return names.join(", ");
  }
  return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
}

export async function TournamentsTeaser() {
  const tournaments = await tournamentService.listPublicTournamentsWithBrackets();
  if (tournaments.length === 0) {
    return null;
  }

  const groups = (
    await Promise.all(
      tournaments.map(async (tournament) => ({
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        categories: await Promise.all(
          tournament.categories.map(async (category) => ({
            categoryId: category.id,
            categoryName: category.name,
            snapshot: categorySnapshot(await standingsService.getStandings(category.id)),
          })),
        ),
      })),
    )
  ).filter((group) => group.categories.length > 0);

  if (groups.length === 0) {
    return null;
  }

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

        <div className="mt-8 flex flex-col gap-4">
          {groups.map((group) => (
            <details
              key={group.tournamentId}
              className="group border-line bg-navy-800 hover:border-green/45 overflow-hidden rounded-2xl border transition-colors"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-6 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="font-jetbrains text-coral text-[10px] tracking-[0.18em] uppercase">
                    {group.categories.length} categor{group.categories.length === 1 ? "y" : "ies"}
                  </span>
                  <h3 className="font-display mt-2 text-2xl font-extrabold tracking-[0.01em] uppercase">
                    {group.tournamentName}
                  </h3>
                  <p className="text-slate mt-2 text-[14.5px]">
                    {categoryPreview(group.categories.map((category) => category.categoryName))}
                  </p>
                </span>
                <ChevronDown
                  aria-hidden
                  className="text-slate size-5 shrink-0 transition-transform group-open:rotate-180"
                />
              </summary>

              <div className="border-line border-t p-6">
                <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
                  {group.categories.map((category) => (
                    <Link
                      key={category.categoryId}
                      href={`/tournaments/${group.tournamentId}`}
                      className="border-line bg-navy-900 hover:border-green/45 rounded-xl border p-5 transition-colors"
                    >
                      <h4 className="font-display text-xl font-extrabold tracking-[0.01em] uppercase">
                        {category.categoryName}
                      </h4>
                      <p className="text-slate mt-2 text-[14.5px]">{category.snapshot}</p>
                    </Link>
                  ))}
                </div>

                {/* Now scoped to this tournament's own row, so it's
                    unambiguous even with several tournaments live at once —
                    the old flat grid had to hide this CTA entirely in that
                    case, since it couldn't tell which tournament it meant. */}
                <Link
                  href={`/tournaments/${group.tournamentId}`}
                  className="border-line text-bone hover:border-green focus-visible:outline-green mt-6 inline-flex items-center gap-2 rounded-full border px-6 py-3 text-sm font-bold transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  See live bracket &amp; standings
                </Link>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
