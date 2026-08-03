import { Badge } from "@/components/ui/badge";
import type { BookingStatus } from "@/lib/generated/prisma/enums";

// Customer-facing counterpart to BookingStatusBadge, used only on /lookup
// — the sole place a BookingStatus reaches a customer. Kept as a
// separate component (not a variant of the shared one) so staff-facing
// screens keep their precise internal wording ("Pending Verification",
// etc.) while this stays banned-word-clean per the wording-sweep rules.
// PENDING_VERIFICATION in particular is reworded from "Pending
// Verification" to "Reserved" — that literal string contains the banned
// phrase "pending verification", and states what we ARE doing (holding
// the slot) rather than what a human hasn't finished doing yet.
const CUSTOMER_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PAID: "Paid",
  CHECKED_IN: "Checked In",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
  AWAITING_PAYMENT: "Awaiting Payment",
  PENDING_VERIFICATION: "Reserved",
  REJECTED: "Rejected",
  REFUNDED: "Refunded",
};

const CUSTOMER_STATUS_VARIANTS: Record<BookingStatus, "success" | "outline" | "destructive"> = {
  PENDING: "outline",
  CONFIRMED: "success",
  PAID: "success",
  CHECKED_IN: "success",
  COMPLETED: "success",
  CANCELLED: "destructive",
  NO_SHOW: "destructive",
  AWAITING_PAYMENT: "outline",
  PENDING_VERIFICATION: "success",
  REJECTED: "destructive",
  REFUNDED: "destructive",
};

export function CustomerBookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge variant={CUSTOMER_STATUS_VARIANTS[status]}>{CUSTOMER_STATUS_LABELS[status]}</Badge>;
}
