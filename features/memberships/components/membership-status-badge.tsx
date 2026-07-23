import { Badge } from "@/components/ui/badge";
import type { MembershipStatus } from "@/lib/generated/prisma/enums";

const STATUS_LABELS: Record<MembershipStatus, string> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

const STATUS_VARIANTS: Record<MembershipStatus, "success" | "outline" | "warning" | "destructive"> = {
  PENDING: "outline",
  ACTIVE: "success",
  EXPIRED: "warning",
  CANCELLED: "destructive",
};

export function MembershipStatusBadge({ status }: { status: MembershipStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
