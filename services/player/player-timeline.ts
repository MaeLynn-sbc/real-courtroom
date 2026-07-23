// Pure — no Prisma import, unit-tested directly. player.service.ts's
// getPlayerTimeline fetches events from four different tables (Booking,
// OpenPlayRegistration, TournamentRegistration, MembershipHistory) and
// hands them here to be merged into one chronological feed.

export type PlayerTimelineEventType =
  | "BOOKING"
  | "OPEN_PLAY_REGISTRATION"
  | "TOURNAMENT_REGISTRATION"
  | "MEMBERSHIP_EVENT"
  | "SALE";

export interface PlayerTimelineEvent {
  type: PlayerTimelineEventType;
  occurredAt: Date;
  title: string;
  description?: string;
}

// Most-recent-first, matching how every other history/activity list in
// this app is ordered.
export function mergeTimelineEvents(events: PlayerTimelineEvent[]): PlayerTimelineEvent[] {
  return [...events].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}
