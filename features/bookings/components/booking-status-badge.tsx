import { Badge } from "@/components/ui/badge";
import type { BookingStatus } from "@/lib/generated/prisma/enums";

const STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PAID: "Paid",
  CHECKED_IN: "Checked In",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
};

const STATUS_VARIANTS: Record<BookingStatus, "success" | "outline" | "destructive"> = {
  PENDING: "outline",
  CONFIRMED: "success",
  PAID: "success",
  CHECKED_IN: "success",
  COMPLETED: "success",
  CANCELLED: "destructive",
  NO_SHOW: "destructive",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
