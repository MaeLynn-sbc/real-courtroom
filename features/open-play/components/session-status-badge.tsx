import { Badge } from "@/components/ui/badge";
import type { OpenPlaySessionStatus } from "@/lib/generated/prisma/enums";

const STATUS_LABELS: Record<OpenPlaySessionStatus, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STATUS_VARIANTS: Record<OpenPlaySessionStatus, "success" | "outline" | "destructive"> = {
  SCHEDULED: "outline",
  IN_PROGRESS: "success",
  COMPLETED: "success",
  CANCELLED: "destructive",
};

export function SessionStatusBadge({ status }: { status: OpenPlaySessionStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
