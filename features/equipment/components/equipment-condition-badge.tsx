import { Badge } from "@/components/ui/badge";
import type { EquipmentCondition } from "@/services/equipment/equipment-condition";

const CONDITION_LABELS: Record<EquipmentCondition, string> = {
  AVAILABLE: "Available",
  RENTED: "Rented",
  DAMAGED: "Damaged",
  MAINTENANCE: "Maintenance",
  RETIRED: "Retired",
};

const CONDITION_VARIANTS: Record<EquipmentCondition, "success" | "outline" | "warning" | "destructive"> = {
  AVAILABLE: "success",
  RENTED: "outline",
  DAMAGED: "destructive",
  MAINTENANCE: "warning",
  RETIRED: "destructive",
};

export function EquipmentConditionBadge({ condition }: { condition: EquipmentCondition }) {
  return <Badge variant={CONDITION_VARIANTS[condition]}>{CONDITION_LABELS[condition]}</Badge>;
}
