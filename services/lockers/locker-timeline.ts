// Pure — no Prisma import, unit-tested directly. locker.service.ts's
// getTransactionTimeline fetches this locker's LockerRental and
// LockerMaintenanceLog rows and hands them here to be merged into one
// chronological feed — same pattern as services/equipment/equipment-timeline.ts.

export type LockerTimelineEventType =
  | "RENTAL_ISSUED"
  | "RENTAL_ENDED"
  | "RENTAL_EXPIRED"
  | "MAINTENANCE_LOGGED"
  | "MAINTENANCE_RESOLVED";

export interface LockerTimelineEvent {
  type: LockerTimelineEventType;
  occurredAt: Date;
  title: string;
  description?: string;
}

export function mergeTimelineEvents(events: LockerTimelineEvent[]): LockerTimelineEvent[] {
  return [...events].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}
