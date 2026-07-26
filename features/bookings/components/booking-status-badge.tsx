import { Badge } from "@/components/ui/badge";
import type { BookingStatus } from "@/lib/generated/prisma/enums";

// AWAITING_PAYMENT/PENDING_VERIFICATION/REJECTED/REFUNDED (Phase 8
// plumbing, Gate 1): no service sets a booking to any of these yet, so
// this badge never actually renders them — entries exist only because
// Record<BookingStatus, ...> is exhaustive.
const STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PAID: "Paid",
  CHECKED_IN: "Checked In",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
  AWAITING_PAYMENT: "Awaiting Payment",
  PENDING_VERIFICATION: "Pending Verification",
  REJECTED: "Rejected",
  REFUNDED: "Refunded",
};

const STATUS_VARIANTS: Record<BookingStatus, "success" | "outline" | "destructive"> = {
  PENDING: "outline",
  CONFIRMED: "success",
  PAID: "success",
  CHECKED_IN: "success",
  COMPLETED: "success",
  CANCELLED: "destructive",
  NO_SHOW: "destructive",
  AWAITING_PAYMENT: "outline",
  PENDING_VERIFICATION: "outline",
  REJECTED: "destructive",
  REFUNDED: "destructive",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
