import type { MembershipStatus } from "@/lib/generated/prisma/enums";

// Pure state machine — same shape as services/booking/booking-status.ts.
// More permissive than most of this app's one-way machines: CANCELLED ->
// ACTIVE is legal specifically because "suspend" (see
// ARCHITECTURE.md's Phase 7 addendum — there is no dedicated SUSPENDED
// status) sets status to CANCELLED, and "reactivate" needs to be able to
// undo that.
export const MEMBERSHIP_STATUS_TRANSITIONS: Record<MembershipStatus, MembershipStatus[]> = {
  PENDING: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["EXPIRED", "CANCELLED"],
  EXPIRED: ["ACTIVE", "CANCELLED"],
  CANCELLED: ["ACTIVE"],
};

export function canTransitionMembershipStatus(
  from: MembershipStatus,
  to: MembershipStatus,
): boolean {
  if (from === to) {
    return false;
  }
  return MEMBERSHIP_STATUS_TRANSITIONS[from].includes(to);
}
