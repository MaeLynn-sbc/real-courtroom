import { prisma } from "@/lib/prisma";
import { formatAuditLogLabel, formatEntityTypeLabel } from "@/services/notifications/notification-reference";

export interface ActivityFeedEntry {
  id: string;
  label: string;
  entityTypeLabel: string;
  entityId: string | null;
  actorName: string | null;
  createdAt: Date;
}

export interface ActivityFeedFilters {
  from?: Date;
  to?: Date;
  entityType?: string;
  actorUserId?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;

// Reads AuditLog directly rather than re-deriving domain events from
// Booking/OpenPlay/Tournament/etc — every mutating service call across
// every phase already writes {action, entityType, entityId, userId,
// createdAt} there, so AuditLog already is a comprehensive cross-module
// activity log. See ARCHITECTURE.md's Phase 9 addendum.
export class ActivityFeedService {
  async getActivityFeed(filters: ActivityFeedFilters = {}): Promise<ActivityFeedEntry[]> {
    const entries = await prisma.auditLog.findMany({
      where: {
        createdAt: { gte: filters.from, lte: filters.to },
        entityType: filters.entityType,
        userId: filters.actorUserId,
      },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: filters.limit ?? DEFAULT_LIMIT,
    });

    return entries.map((entry) => ({
      id: entry.id,
      label: formatAuditLogLabel(entry.action),
      entityTypeLabel: formatEntityTypeLabel(entry.entityType),
      entityId: entry.entityId,
      actorName: entry.user ? (entry.user.name ?? entry.user.email) : null,
      createdAt: entry.createdAt,
    }));
  }
}

export const activityFeedService = new ActivityFeedService();
