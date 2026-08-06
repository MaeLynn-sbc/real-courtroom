import type { BookingStatus } from "@/lib/generated/prisma/enums";

// Pure state machine — drives both service-level validation
// (booking.service.ts) and which status action buttons the UI shows
// (booking-status-actions.tsx). PAID has no reachable transitions in this
// phase (payment integration is out of scope); it stays a valid schema
// value that nothing here transitions into or out of.
//
// Phase 8 Gate 2 (BUILD-SPEC.md §8): this table is "which status changes
// are a simple staff button click with no required side effects" — that's
// exactly what booking-status-actions.tsx assumes (it renders one button
// per entry here, wired straight to the generic updateBookingStatusAction,
// which does nothing but flip the status + write history). AWAITING_
// PAYMENT -> CANCELLED fits that shape (a staff member manually freeing a
// stale hold has no more side effects than any other cancellation) and IS
// wired below.
//
// AWAITING_PAYMENT -> PENDING_VERIFICATION, PENDING_VERIFICATION ->
// CONFIRMED, and PENDING_VERIFICATION -> REJECTED do NOT go through this
// table on purpose, even though they're real, reachable transitions now.
// Each has a required side effect this generic mechanism can't perform:
// submitting proof creates a BookingPaymentProof row, approving creates a
// Sale (needs a verifying Employee + open Shift), rejecting writes the
// proof's resolution fields. Routing them through this table would put a
// "Verify payment"/"Reject" button on the generic booking-detail screen
// that flips status with none of that — a booking marked CONFIRMED with
// no Sale behind it, or PENDING_VERIFICATION with no proof row to match.
// services/booking/booking-payment-proof.service.ts's submit/approve/
// reject methods each check the booking's current status inline instead,
// tightly coupled to the side effect they perform alongside it.
//
// REFUNDED stays unreachable here (empty in, empty out) for the identical
// reason — wiring CONFIRMED -> REFUNDED into this table would make it a
// bare button with no required Employee/reason, violating the same "no
// anonymous refunds" rule write-offs already enforce. It IS reachable now
// (2026-08-06), just not through this generic table — see
// services/booking/booking-refund.service.ts's refundBooking, which
// requires both and voids the linked Sale atomically with the transition.
export const BOOKING_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  PAID: [],
  CHECKED_IN: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  AWAITING_PAYMENT: ["CANCELLED"],
  PENDING_VERIFICATION: [],
  REJECTED: [],
  REFUNDED: [],
};

export function canTransitionBookingStatus(from: BookingStatus, to: BookingStatus): boolean {
  if (from === to) {
    return false;
  }
  return BOOKING_STATUS_TRANSITIONS[from].includes(to);
}
