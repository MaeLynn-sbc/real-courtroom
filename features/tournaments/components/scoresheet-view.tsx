"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { scheduleMatchAction } from "@/actions/tournament.actions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ScoresheetMatch {
  id: string;
  poolLabel: string | null;
  round: number | null;
  team1Name: string;
  team2Name: string;
  courtId: string | null;
  courtName: string | null;
}

interface ScoresheetViewProps {
  tournamentId: string;
  categoryId: string;
  categoryName: string;
  tournamentName: string;
  matches: ScoresheetMatch[];
  courts: { id: string; name: string }[];
}

const NO_COURT_VALUE = "__none__";

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
  courts,
}: ScoresheetViewProps) {
  const pools = Array.from(groupByPool(matches).entries()).sort(([a], [b]) =>
    (a ?? "").localeCompare(b ?? ""),
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
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
                  </tr>
                </thead>
                <tbody>
                  {poolMatches.map((match) => (
                    <ScoresheetRow
                      key={match.id}
                      tournamentId={tournamentId}
                      categoryId={categoryId}
                      match={match}
                      courts={courts}
                    />
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

// Owner request (2026-08-11): "remove this and put it on other tabs.
// the schedule. it shouldnt conflict with the score cards" — court
// assignment lives here now instead of on the score-entry match card.
// Each row keeps its own local court state (same shape match-card.tsx
// used to have) so editing one match never touches another's unsaved
// input. The editor is print:hidden; a plain-text duplicate of the same
// court (hidden on screen, shown only on print) is what actually
// prints, so the printed sheet stays a clean line, not a form control.
// Owner request (2026-08-15): "remove the scheduling. i dont need it.
// all games doesnt have real schedule" — dropped the scheduledAt time
// input entirely; court assignment alone is what's left. scheduleMatch
// still technically accepts a scheduledAt (Match.scheduledAt stays in
// the schema, untouched — no migration, nothing reads it once this form
// stops sending it), just nothing here calls it anymore.
function ScoresheetRow({
  tournamentId,
  categoryId,
  match,
  courts,
}: {
  tournamentId: string;
  categoryId: string;
  match: ScoresheetMatch;
  courts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [courtId, setCourtId] = useState(match.courtId ?? NO_COURT_VALUE);

  function handleSave() {
    startTransition(async () => {
      const result = await scheduleMatchAction(tournamentId, categoryId, match.id, {
        courtId: courtId === NO_COURT_VALUE ? undefined : courtId,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Match scheduled.");
      router.refresh();
    });
  }

  return (
    <tr className="border-b">
      <td className="py-2">{match.round ?? "—"}</td>
      <td className="py-2">{match.team1Name}</td>
      <td className="py-2">
        <span className="inline-block w-16 border-b border-dotted">&nbsp;</span>
      </td>
      <td className="py-2">{match.team2Name}</td>
      <td className="py-2">
        <span className="inline-block w-16 border-b border-dotted">&nbsp;</span>
      </td>
      <td className="py-2">
        <span className="hidden print:inline">{match.courtName ?? "—"}</span>
        <div className="flex flex-wrap items-center gap-1.5 print:hidden">
          <Select value={courtId} onValueChange={(value) => value && setCourtId(value)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue>
                {courtId === NO_COURT_VALUE ? "No court" : (courts.find((c) => c.id === courtId)?.name ?? "No court")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_COURT_VALUE}>No court</SelectItem>
              {courts.map((court) => (
                <SelectItem key={court.id} value={court.id}>
                  {court.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleSave}>
            Save
          </Button>
        </div>
      </td>
    </tr>
  );
}
