import type { OpenPlayWaitlistEntryStatus } from "@/lib/generated/prisma/enums";

// Pure state machine for OpenPlayWaitlistEntry (BUILD-SPEC.md §6, "PARKED"
// subsection) — same shape and purpose as booking-status.ts's
// canTransitionBookingStatus, built first and in isolation so it's
// reviewable and unit-testable before any service wires it in (Gate 1
// stops here; Gate 2 is where a real service calls this).
//
// WAITING -> INVITED: a slot freed and this was the oldest still-WAITING
//   entry for the session. The service action that performs this also
//   creates the real AWAITING_PAYMENT registration in the same
//   transaction — not this table's concern, just documented here so the
//   transition's real-world meaning is clear.
// INVITED -> CONVERTED: proof was submitted and verified before
//   inviteExpiresAt. Success, terminal.
// INVITED -> EXPIRED: inviteExpiresAt passed with no proof submitted.
//   Terminal for THIS entry — does not return to WAITING. This is a
//   default assumption, not a confirmed business rule (see
//   OpenPlayWaitlistEntryStatus's own schema comment) — if "give them a
//   second chance at the back of the line" is wanted instead, add
//   EXPIRED: ["WAITING"] below; nothing else in this file needs to
//   change for that.
// WAITING/EXPIRED/CONVERTED have no other reachable transitions in this
// gate. A WAITING entry could plausibly go straight to some CANCELLED
// state (a player asking to be removed from the list) — not modeled
// yet; no UI or service asks for it this gate, and adding a status
// nothing can reach yet would be exactly the kind of unreachable-value
// warning schema.prisma's own OpenPlayNightRegistrationStatus comment
// already flags as worth avoiding.
export const OPEN_PLAY_WAITLIST_ENTRY_TRANSITIONS: Record<OpenPlayWaitlistEntryStatus, OpenPlayWaitlistEntryStatus[]> =
  {
    WAITING: ["INVITED"],
    INVITED: ["CONVERTED", "EXPIRED"],
    EXPIRED: [],
    CONVERTED: [],
  };

export function canTransitionOpenPlayWaitlistEntryStatus(
  from: OpenPlayWaitlistEntryStatus,
  to: OpenPlayWaitlistEntryStatus,
): boolean {
  if (from === to) {
    return false;
  }
  return OPEN_PLAY_WAITLIST_ENTRY_TRANSITIONS[from].includes(to);
}
