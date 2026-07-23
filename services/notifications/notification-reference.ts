// Pure — no Prisma import, unit-tested directly. Both the Notification
// Center and the Activity Feed (which reads AuditLog directly, see
// activity-feed.service.ts) need to turn a machine-shaped action/entityType
// string into something a human can read. Generic string transforms are
// used instead of a per-action lookup table so a new "entity.verb" action
// added by any future service is labeled correctly without this file
// needing an update.

// "equipment_rental.created" -> "Equipment rental created"
export function formatAuditLogLabel(action: string): string {
  const words = action.replace(/\./g, " ").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// "EquipmentRental" -> "Equipment Rental"
export function formatEntityTypeLabel(entityType: string): string {
  return entityType.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}
