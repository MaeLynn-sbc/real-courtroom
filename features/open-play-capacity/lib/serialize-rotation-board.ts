import type {
  GameAssignmentWithParticipants,
  RotationBoardData,
} from "@/services/open-play/open-play-rotation.service";

// Server data -> RotationBoard props. Shared by the open play day page
// and the Practice page so both render the identical board.

function serializeAssignment(
  assignment: GameAssignmentWithParticipants,
  nudgeMinutes: number,
  targetGameMinutes: number,
) {
  const waitingToStart =
    assignment.status === "PROPOSED" &&
    Date.now() - assignment.proposedAt.getTime() >= nudgeMinutes * 60_000;
  // Court timer, staff-facing: same targetGameMinutes soft target the TV
  // display's own countdown uses (display.service.ts's identical
  // start + targetGameMinutes computation) — a shared setting, not a
  // second one invented here, so the two screens never disagree. Only
  // meaningful once a game is actually ACTIVE (has a real startedAt);
  // a PROPOSED group hasn't started its clock yet.
  const endAt =
    assignment.status === "ACTIVE" && assignment.startedAt
      ? new Date(assignment.startedAt.getTime() + targetGameMinutes * 60_000).toISOString()
      : null;
  return {
    id: assignment.id,
    source: assignment.source,
    status: assignment.status,
    skillSpread: assignment.skillSpread,
    startedAt: assignment.startedAt ? assignment.startedAt.toISOString() : null,
    endAt,
    announcementRequestedAt: assignment.announcementRequestedAt
      ? assignment.announcementRequestedAt.toISOString()
      : null,
    timesUpRequestedAt: assignment.timesUpRequestedAt
      ? assignment.timesUpRequestedAt.toISOString()
      : null,
    // Manual timer/announce forgotten-assignment nudge: computed here,
    // at render time, not pushed to the client as raw proposedAt +
    // minutes — this page now re-renders on the tab wrapper's own
    // auto-poll (OpenPlaySessionTabs), so "now" at serialization time
    // stays fresh automatically every refresh, same as before.
    waitingToStart,
    participants: assignment.participants.map((p) => ({
      registrationId: p.registrationId,
      playerName: p.registration.playerName,
      skillLevel: p.registration.skillLevel,
    })),
  };
}

export function serializeBoard(dateParam: string, board: RotationBoardData, targetGameMinutes: number) {
  return {
    date: dateParam,
    courts: board.courts.map((c) => ({
      id: c.court.id,
      name: c.court.name,
      active: c.active
        ? serializeAssignment(c.active, board.forgottenAssignmentNudgeMinutes, targetGameMinutes)
        : null,
      proposed: c.proposed
        ? serializeAssignment(c.proposed, board.forgottenAssignmentNudgeMinutes, targetGameMinutes)
        : null,
      booked: c.booked,
    })),
    waiting: board.waiting,
    resting: board.resting,
    maxWaitMinutes: board.maxWaitMinutes,
    unfillableQueueReason: board.unfillableQueueReason,
    stagedGroups: board.stagedGroups.map((group) => ({
      id: group.id,
      slot: group.slot,
      source: group.source,
      members: group.members,
    })),
  };
}

