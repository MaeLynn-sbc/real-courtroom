import type { BookingStatus } from "@/lib/generated/prisma/enums";

// Pure state machine — drives both service-level validation
// (booking.service.ts) and which status action buttons the UI shows
// (booking-status-actions.tsx). PAID has no reachable transitions in this
// phase (payment integration is out of scope); it stays a valid schema
// value that nothing here transitions into or out of.
//
// Phase 8 plumbing (BUILD-SPEC.md §8): AWAITING_PAYMENT/
// PENDING_VERIFICATION/REJECTED/REFUNDED are schema-only additions from
// Gate 1 — same "reserved, not yet reachable" shape as PAID above. All
// four are empty here on purpose: this file is the actual authorization
// for which transitions are ALLOWED, so wiring them in is exactly the
// hard boundary this phase must not cross yet. Gate 2 (services) is
// where the real graph lands — sketched here for whoever builds it,
// not active:
//   AWAITING_PAYMENT -> [PENDING_VERIFICATION, CANCELLED]   (submit / hold expires)
//   PENDING_VERIFICATION -> [CONFIRMED, REJECTED]           (staff approves / rejects)
//   CONFIRMED -> [..existing.., REFUNDED]                   (staff-initiated cash refund)
//   REJECTED -> []                                          (terminal, same shape as CANCELLED)
//   REFUNDED -> []                                          (terminal, same shape as CANCELLED)
export const BOOKING_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  PAID: [],
  CHECKED_IN: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  AWAITING_PAYMENT: [],
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
