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

export function CourtStatusPanel({ courts }: { courts: CourtStatusSnapshotEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Court status</CardTitle>
      </CardHeader>
      <CardContent>
        {courts.length === 0 ? (
          <p className="text-muted-foreground text-sm">No courts configured yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {courts.map((court) => (
              <li
                key={court.id}
                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span
                  className={cn("size-2 shrink-0 rounded-full", STATE_DOT_CLASSES[court.state])}
                  aria-hidden="true"
                />
                <span className="flex flex-col">
                  <span className="font-medium">{court.name}</span>
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
