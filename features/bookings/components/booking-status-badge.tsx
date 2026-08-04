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
  AWAITING_PAYMENT: "Awaiting Payment",
  PENDING_VERIFICATION: "Pending Verification",
  REJECTED: "Rejected",
  REFUNDED: "Refunded",
};

// AWAITING_PAYMENT (grey outline) and PENDING_VERIFICATION (amber) used
// to both render "outline" — identical color, told apart only by label
// text. Reported live: staff couldn't spot which bookings still needed
// payment verification at a glance. PENDING_VERIFICATION now gets
// "warning" — it's the one that actually needs a staff action (a
// submitted proof sitting unreviewed); AWAITING_PAYMENT stays neutral
// "outline" since nothing's waiting on staff yet, just the customer.
const STATUS_VARIANTS: Record<BookingStatus, "success" | "outline" | "destructive" | "warning"> = {
  PENDING: "outline",
  CONFIRMED: "success",
  PAID: "success",
  CHECKED_IN: "success",
  COMPLETED: "success",
  CANCELLED: "destructive",
  NO_SHOW: "destructive",
  AWAITING_PAYMENT: "outline",
  PENDING_VERIFICATION: "warning",
  REJECTED: "destructive",
  REFUNDED: "destructive",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
