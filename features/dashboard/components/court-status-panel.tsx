import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CourtStatusSnapshotEntry } from "@/services/court/court.service";

const STATE_LABELS: Record<CourtStatusSnapshotEntry["state"], string> = {
  AVAILABLE: "Available",
  OCCUPIED: "Occupied",
  MAINTENANCE: "Maintenance",
  DISABLED: "Disabled",
};

const STATE_DOT_CLASSES: Record<CourtStatusSnapshotEntry["state"], string> = {
  AVAILABLE: "bg-success",
  OCCUPIED: "bg-court-blue",
  MAINTENANCE: "bg-warning",
  DISABLED: "bg-destructive",
};

// Occupied courts get a tinted card, not just a different dot colour:
// on a three-court board the thing a staff member needs at a glance is
// which ones are in play, and a 8px dot is not that signal. AVAILABLE
// stays deliberately quiet — a free court is the resting state, and
// making every tile shout leaves nothing for the exception to say.
const STATE_TILE_CLASSES: Record<CourtStatusSnapshotEntry["state"], string> = {
  AVAILABLE: "border-border/70",
  OCCUPIED: "border-court-blue/40 bg-court-blue/10",
  MAINTENANCE: "border-warning/40 bg-warning/10",
  DISABLED: "border-destructive/40 bg-destructive/10",
};

export function CourtStatusPanel({ courts }: { courts: CourtStatusSnapshotEntry[] }) {
  // Derived from the same array that was already being rendered — no new
  // query, no new prop. The old header said only "Court status", so the
  // one-line answer ("2 of 3 free") had to be assembled by the reader
  // out of however many tiles there happened to be.
  const availableCount = courts.filter((court) => court.state === "AVAILABLE").length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Court status</CardTitle>
        {courts.length > 0 ? (
          <span className="text-muted-foreground text-xs font-semibold tabular-nums">
            {availableCount} of {courts.length} free
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        {courts.length === 0 ? (
          <p className="text-muted-foreground text-sm">No courts configured yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {courts.map((court) => (
              <li
                key={court.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm",
                  STATE_TILE_CLASSES[court.state],
                )}
              >
                <span
                  className={cn("size-2 shrink-0 rounded-full", STATE_DOT_CLASSES[court.state])}
                  aria-hidden="true"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{court.name}</span>
                  <span className="text-muted-foreground text-xs">{STATE_LABELS[court.state]}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
