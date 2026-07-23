import type { OpenPlayQueueStatus } from "@/lib/generated/prisma/enums";

// Pure state machine for a single OpenPlayQueue entry's rotation status.
// It's a cycle, not a one-way pipeline: Waiting -> Playing -> Resting ->
// Waiting (staff-triggered at every step, no automatic timers). A queue
// entry can also be removed entirely (queue.service.ts's removeFromQueue),
// which isn't a status value and so isn't represented here.
export const OPEN_PLAY_QUEUE_STATUS_TRANSITIONS: Record<OpenPlayQueueStatus, OpenPlayQueueStatus[]> = {
  WAITING: ["PLAYING"],
  PLAYING: ["RESTING"],
  RESTING: ["WAITING"],
};

export function canTransitionQueueStatus(
  from: OpenPlayQueueStatus,
  to: OpenPlayQueueStatus,
): boolean {
  if (from === to) {
    return false;
  }
  return OPEN_PLAY_QUEUE_STATUS_TRANSITIONS[from].includes(to);
}
