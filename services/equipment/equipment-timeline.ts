// Pure — no Prisma import, unit-tested directly. equipment.service.ts's
// getTransactionTimeline fetches this equipment's EquipmentRental and
// EquipmentMaintenanceLog rows and hands them here to be merged into one
// chronological feed — the recommended "Transaction History" view,
// derived rather than stored (same pattern as
// services/player/player-timeline.ts).

export type EquipmentTimelineEventType =
  | "RENTAL_ISSUED"
  | "RENTAL_RETURNED"
  | "RENTAL_LOST"
  | "MAINTENANCE_LOGGED"
  | "MAINTENANCE_RESOLVED";

export interface EquipmentTimelineEvent {
  type: EquipmentTimelineEventType;
  occurredAt: Date;
  title: string;
  description?: string;
}

export function mergeTimelineEvents(events: EquipmentTimelineEvent[]): EquipmentTimelineEvent[] {
  return [...events].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}
