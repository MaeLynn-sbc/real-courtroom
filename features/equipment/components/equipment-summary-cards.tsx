import { Card, CardContent } from "@/components/ui/card";
import type { EquipmentInventorySummary } from "@/services/equipment/equipment.service";

const STAT_LABELS: Record<keyof EquipmentInventorySummary, string> = {
  availableCount: "Available",
  rentedCount: "Rented",
  maintenanceCount: "Maintenance",
  damagedCount: "Damaged",
  overdueCount: "Overdue",
};

// Computed on read, never stored — see equipmentService.getInventorySummary.
export function EquipmentSummaryCards({ summary }: { summary: EquipmentInventorySummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {(Object.keys(STAT_LABELS) as Array<keyof EquipmentInventorySummary>).map((key) => (
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
