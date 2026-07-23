import type { TournamentStatus } from "@/lib/generated/prisma/enums";

// Pure state machine — same shape as services/booking/booking-status.ts and
// services/open-play/session-status.ts. Drives both tournament.service.ts
// validation and which status action buttons the UI shows.
export const TOURNAMENT_STATUS_TRANSITIONS: Record<TournamentStatus, TournamentStatus[]> = {
  DRAFT: ["REGISTRATION_OPEN", "CANCELLED"],
  REGISTRATION_OPEN: ["REGISTRATION_CLOSED", "CANCELLED"],
  REGISTRATION_CLOSED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionTournamentStatus(
  from: TournamentStatus,
  to: TournamentStatus,
): boolean {
  if (from === to) {
    return false;
  }
  return TOURNAMENT_STATUS_TRANSITIONS[from].includes(to);
}
