import type { BookingStatus } from "@/lib/generated/prisma/enums";

// Pure state machine — drives both service-level validation
// (booking.service.ts) and which status action buttons the UI shows
// (booking-status-actions.tsx). PAID has no reachable transitions in this
// phase (payment integration is out of scope); it stays a valid schema
// value that nothing here transitions into or out of.
export const BOOKING_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  PAID: [],
  CHECKED_IN: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransitionBookingStatus(from: BookingStatus, to: BookingStatus): boolean {
  if (from === to) {
    return false;
  }
  return BOOKING_STATUS_TRANSITIONS[from].includes(to);
}
