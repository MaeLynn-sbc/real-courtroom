import { Badge } from "@/components/ui/badge";
import type { LockerRentalStatus } from "@/lib/generated/prisma/enums";

const STATUS_LABELS: Record<LockerRentalStatus, string> = {
  ACTIVE: "Active",
  EXPIRED: "Expired",
  CANCELLED: "Ended",
};

// CANCELLED renders "destructive" for consistency with every other
// module's cancelled/terminated state (it previously rendered "outline"
// here only, a cross-module inconsistency fixed in v1.1 Sub-phase 5).
const STATUS_VARIANTS: Record<LockerRentalStatus, "success" | "warning" | "destructive"> = {
  ACTIVE: "success",
  EXPIRED: "warning",
  CANCELLED: "destructive",
};

export function LockerRentalStatusBadge({ status }: { status: LockerRentalStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
