import { Badge } from "@/components/ui/badge";
import type { CourtStatus } from "@/lib/generated/prisma/enums";

const STATUS_LABELS: Record<CourtStatus, string> = {
  ACTIVE: "Active",
  MAINTENANCE: "Maintenance",
  DISABLED: "Disabled",
};

const STATUS_VARIANTS: Record<CourtStatus, "success" | "warning" | "destructive"> = {
  ACTIVE: "success",
  MAINTENANCE: "warning",
  DISABLED: "destructive",
};

export function CourtStatusBadge({ status }: { status: CourtStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
