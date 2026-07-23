import { Badge } from "@/components/ui/badge";
import type { RentalStatus } from "@/lib/generated/prisma/enums";

const STATUS_LABELS: Record<RentalStatus, string> = {
  ACTIVE: "Active",
  RETURNED: "Returned",
  OVERDUE: "Overdue",
  LOST: "Lost",
};

const STATUS_VARIANTS: Record<RentalStatus, "success" | "outline" | "warning" | "destructive"> = {
  ACTIVE: "success",
  RETURNED: "outline",
  OVERDUE: "warning",
  LOST: "destructive",
};

export function EquipmentRentalStatusBadge({ status }: { status: RentalStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
