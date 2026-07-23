import type { LockerRentalStatus } from "@/lib/generated/prisma/enums";

// Pure state machine — same shape as services/booking/booking-status.ts.
// There's no RETURNED value — ending a rental early maps to CANCELLED,
// EXPIRED is reserved for the lazy time-based reconciliation in
// locker-rental.service.ts.
export const LOCKER_RENTAL_STATUS_TRANSITIONS: Record<LockerRentalStatus, LockerRentalStatus[]> = {
  ACTIVE: ["EXPIRED", "CANCELLED"],
  EXPIRED: [],
  CANCELLED: [],
};

export function canTransitionLockerRentalStatus(
  from: LockerRentalStatus,
  to: LockerRentalStatus,
): boolean {
  if (from === to) {
    return false;
  }
  return LOCKER_RENTAL_STATUS_TRANSITIONS[from].includes(to);
}
