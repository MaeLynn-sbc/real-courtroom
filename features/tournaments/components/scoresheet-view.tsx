"use client";

import Link from "next/link";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ScoresheetMatch {
  id: string;
  poolLabel: string | null;
  round: number | null;
  team1Name: string;
  team2Name: string;
  courtName: string | null;
  scheduledAt: string | null;
}

interface ScoresheetViewProps {
  tournamentId: string;
  categoryId: string;
  categoryName: string;
  tournamentName: string;
  matches: ScoresheetMatch[];
}

const timeFormatter = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" });

function groupByPool(matches: ScoresheetMatch[]): Map<string | null, ScoresheetMatch[]> {
  const groups = new Map<string | null, ScoresheetMatch[]>();
  for (const match of matches) {
    const list = groups.get(match.poolLabel) ?? [];
    list.push(match);
    groups.set(match.poolLabel, list);
  }
  return groups;
}

// Owner request (2026-08-11): "i want it to be lines only so that the
// people can see it" — a plain, printable line-per-match list (not the
// staff match cards with score-entry controls), one line per scheduled
// match: teams, court, time. Print button + a `.print\:hidden` /
// `@media print` pair follow the exact same convention already
// established for the payroll period preview's own print view.
export function ScoresheetView({
  tournamentId,
  categoryId,
  categoryName,
  tournamentName,
  matches,
}: ScoresheetViewProps) {
  const pools = Array.from(groupByPool(matches).entries()).sort(([a], [b]) =>
    (a ?? "").localeCompare(b ?? ""),
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link
          href={`/dashboard/tournaments/${tournamentId}/categories/${categoryId}`}
          className="text-primary text-sm underline underline-offset-2"
        >
          ← Back to category
        </Link>
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <Printer className="mr-1.5 size-4" />
          Print
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{categoryName}</h1>
        <p className="text-muted-foreground text-sm">{tournamentName} · Scoresheet</p>
      </div>

      {matches.length === 0 ? (
        <p className="text-muted-foreground text-sm">No scheduled matches right now.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {pools.map(([poolLabel, poolMatches]) => (
            <div key={poolLabel ?? "none"} className="flex flex-col gap-2">
              {poolLabel ? <h2 className="text-lg font-medium">Pool {poolLabel}</h2> : null}
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-1.5 text-left font-medium">Round</th>
                    <th className="py-1.5 text-left font-medium">Team 1</th>
                    <th className="py-1.5 text-center font-medium">Score</th>
                    <th className="py-1.5 text-left font-medium">Team 2</th>
                    <th className="py-1.5 text-center font-medium">Score</th>
                    <th className="py-1.5 text-left font-medium">Court</th>
                    <th className="py-1.5 text-left font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {poolMatches.map((match) => (
                    <tr key={match.id} className="border-b">
                      <td className="py-2">{match.round ?? "—"}</td>
                      <td className="py-2">{match.team1Name}</td>
                      <td className="py-2">
                        <span className="inline-block w-16 border-b border-dotted">&nbsp;</span>
                      </td>
                      <td className="py-2">{match.team2Name}</td>
                      <td className="py-2">
                        <span className="inline-block w-16 border-b border-dotted">&nbsp;</span>
                      </td>
                      <td className="py-2">{match.courtName ?? "—"}</td>
                      <td className="py-2">
                        {match.scheduledAt ? timeFormatter.format(new Date(match.scheduledAt)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @media print {
          nav, header, .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
