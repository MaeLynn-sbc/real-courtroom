import { Badge } from "@/components/ui/badge";
import type { LockerDisplayStatus } from "@/services/lockers/locker-status";

const STATUS_LABELS: Record<LockerDisplayStatus, string> = {
  AVAILABLE: "Available",
  OCCUPIED: "Occupied",
  RESERVED: "Reserved",
  MAINTENANCE: "Maintenance",
  DISABLED: "Disabled",
};

const STATUS_VARIANTS: Record<LockerDisplayStatus, "success" | "outline" | "warning" | "destructive"> = {
  AVAILABLE: "success",
  OCCUPIED: "outline",
  RESERVED: "outline",
  MAINTENANCE: "warning",
  DISABLED: "destructive",
};

export function LockerStatusBadge({ status }: { status: LockerDisplayStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
