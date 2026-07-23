import type { OpenPlaySessionStatus } from "@/lib/generated/prisma/enums";

// Pure state machine — same shape as services/booking/booking-status.ts.
// Drives both session.service.ts validation and which status action
// buttons the UI shows.
export const OPEN_PLAY_SESSION_STATUS_TRANSITIONS: Record<
  OpenPlaySessionStatus,
  OpenPlaySessionStatus[]
> = {
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionSessionStatus(
  from: OpenPlaySessionStatus,
  to: OpenPlaySessionStatus,
): boolean {
  if (from === to) {
    return false;
  }
  return OPEN_PLAY_SESSION_STATUS_TRANSITIONS[from].includes(to);
}
