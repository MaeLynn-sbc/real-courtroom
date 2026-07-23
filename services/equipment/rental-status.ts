import type { RentalStatus } from "@/lib/generated/prisma/enums";

// Pure state machine — same shape as services/booking/booking-status.ts.
export const RENTAL_STATUS_TRANSITIONS: Record<RentalStatus, RentalStatus[]> = {
  ACTIVE: ["RETURNED", "OVERDUE", "LOST"],
  OVERDUE: ["RETURNED", "LOST"],
  RETURNED: [],
  LOST: [],
};

export function canTransitionRentalStatus(from: RentalStatus, to: RentalStatus): boolean {
  if (from === to) {
    return false;
  }
  return RENTAL_STATUS_TRANSITIONS[from].includes(to);
}
