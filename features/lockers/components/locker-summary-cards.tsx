import { Card, CardContent } from "@/components/ui/card";
import type { LockerInventorySummary } from "@/services/lockers/locker.service";

const STAT_LABELS: Record<keyof LockerInventorySummary, string> = {
  availableCount: "Available",
  occupiedCount: "Occupied",
  maintenanceCount: "Maintenance",
  reservedCount: "Reserved",
};

// Computed on read, never stored — see lockerService.getInventorySummary.
export function LockerSummaryCards({ summary }: { summary: LockerInventorySummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(Object.keys(STAT_LABELS) as Array<keyof LockerInventorySummary>).map((key) => (
        <Card key={key} size="sm">
          <CardContent className="flex flex-col items-center gap-1 py-1 text-center">
            <span className="text-2xl font-semibold tabular-nums">{summary[key]}</span>
            <span className="text-muted-foreground text-xs">{STAT_LABELS[key]}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
