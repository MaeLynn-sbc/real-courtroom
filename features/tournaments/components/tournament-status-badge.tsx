import { Badge } from "@/components/ui/badge";
import type { TournamentStatus } from "@/lib/generated/prisma/enums";

const STATUS_LABELS: Record<TournamentStatus, string> = {
  DRAFT: "Draft",
  REGISTRATION_OPEN: "Registration Open",
  REGISTRATION_CLOSED: "Registration Closed",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STATUS_VARIANTS: Record<TournamentStatus, "success" | "outline" | "destructive"> = {
  DRAFT: "outline",
  REGISTRATION_OPEN: "success",
  REGISTRATION_CLOSED: "outline",
  IN_PROGRESS: "success",
  COMPLETED: "success",
  CANCELLED: "destructive",
};

export function TournamentStatusBadge({ status }: { status: TournamentStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
