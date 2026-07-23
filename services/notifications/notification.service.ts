import type { Notification, NotificationType } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { equipmentRentalService } from "@/services/equipment/equipment-rental.service";

const BOOKING_REMINDER_WINDOW_HOURS = 24;
const MEMBERSHIP_REMINDER_WINDOW_DAYS = 7;
const TOURNAMENT_REMINDER_WINDOW_DAYS = 3;
const LOCKER_REMINDER_WINDOW_DAYS = 3;

function addHours(date: Date, hours: number): Date {
  const result = new Date(date);
  result.setHours(result.getHours() + hours);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

interface ReminderCandidate {
  userId: string;
  entityId: string;
  title: string;
  body: string;
}

// Notifications are personal (tied to one userId), not a broadcast table —
// see ARCHITECTURE.md's Phase 9 addendum. generateReminders() is a lazy
// sweep (no cron infra exists, same no-cron pattern as
// membershipService.reconcileExpiredMemberships /
// equipmentRentalService.reconcileOverdueRentals /
// lockerRentalService.reconcileExpiredRentals): it's called at the top of
// the Notification Center's read path and dedupes on
// userId+type+entityType+entityId so revisiting the page never creates
// duplicates.
export class NotificationService {
  async listForUser(userId: string): Promise<Notification[]> {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async getUnreadCount(userId: string): Promise<number> {
    return prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markRead(notificationId: string, userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  // Fans out one ANNOUNCEMENT notification per active User at publish
  // time — synchronous, not scheduled (facility-scale user count, not a
  // batching concern). Called by announcementService.publish().
  async createAnnouncementNotifications(announcementId: string): Promise<void> {
    const announcement = await prisma.announcement.findUniqueOrThrow({
      where: { id: announcementId },
    });

    const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true } });

    await prisma.notification.createMany({
      data: users.map((user) => ({
        userId: user.id,
        type: "ANNOUNCEMENT" as const,
        entityType: "Announcement",
        entityId: announcementId,
        title: announcement.title,
        body: announcement.body,
      })),
    });
  }

  async generateReminders(): Promise<void> {
    const now = new Date();

    await Promise.all([
      this.generateBookingReminders(now),
      this.generateMembershipReminders(now),
      this.generateTournamentReminders(now),
      this.generateEquipmentReminders(),
      this.generateLockerReminders(now),
    ]);
  }

  private async generateBookingReminders(now: Date): Promise<void> {
    const bookings = await prisma.booking.findMany({
      where: {
        startAt: { gte: now, lte: addHours(now, BOOKING_REMINDER_WINDOW_HOURS) },
        status: { in: ["CONFIRMED", "PAID", "CHECKED_IN"] },
      },
      include: { court: { select: { name: true } }, player: { select: { userId: true } } },
    });

    const candidates: ReminderCandidate[] = bookings.map((booking) => ({
      userId: booking.player?.userId ?? booking.bookedById,
      entityId: booking.id,
      title: "Upcoming booking",
      body: `Your booking on ${booking.court.name} starts at ${booking.startAt.toLocaleString()}.`,
    }));

    await this.notifyManyIfNotExists("BOOKING", "Booking", candidates);
  }

  private async generateMembershipReminders(now: Date): Promise<void> {
    const memberships = await prisma.membership.findMany({
      where: {
        status: "ACTIVE",
        endDate: { gte: now, lte: addDays(now, MEMBERSHIP_REMINDER_WINDOW_DAYS) },
      },
      include: { player: { select: { userId: true } }, membershipPlan: { select: { name: true } } },
    });

    const candidates: ReminderCandidate[] = memberships.map((membership) => ({
      userId: membership.player.userId,
      entityId: membership.id,
      title: "Membership expiring soon",
      body: `Your ${membership.membershipPlan.name} membership expires on ${membership.endDate.toLocaleDateString()}.`,
    }));

    await this.notifyManyIfNotExists("MEMBERSHIP", "Membership", candidates);
  }

  private async generateTournamentReminders(now: Date): Promise<void> {
    const tournaments = await prisma.tournament.findMany({
      where: {
        status: { in: ["REGISTRATION_CLOSED", "IN_PROGRESS"] },
        startDate: { gte: now, lte: addDays(now, TOURNAMENT_REMINDER_WINDOW_DAYS) },
      },
      include: {
        categories: {
          include: {
            registrations: {
              where: { status: "CONFIRMED" },
              include: { team: { select: { player1: { select: { userId: true } }, player2: { select: { userId: true } } } } },
            },
          },
        },
      },
    });

    const candidates: ReminderCandidate[] = [];

    for (const tournament of tournaments) {
      const recipientUserIds = new Set<string>();
      for (const category of tournament.categories) {
        for (const registration of category.registrations) {
          recipientUserIds.add(registration.team.player1.userId);
          if (registration.team.player2) {
            recipientUserIds.add(registration.team.player2.userId);
          }
        }
      }

      for (const userId of recipientUserIds) {
        candidates.push({
          userId,
          entityId: tournament.id,
          title: "Tournament starting soon",
          body: `${tournament.name} starts on ${tournament.startDate.toLocaleDateString()}.`,
        });
      }
    }

    await this.notifyManyIfNotExists("TOURNAMENT", "Tournament", candidates);
  }

  private async generateEquipmentReminders(): Promise<void> {
    await equipmentRentalService.reconcileOverdueRentals();

    const overdueRentals = await prisma.equipmentRental.findMany({
      where: { status: "OVERDUE" },
      include: { equipment: { select: { name: true } }, player: { select: { userId: true } } },
    });

    const candidates: ReminderCandidate[] = overdueRentals.map((rental) => ({
      userId: rental.player.userId,
      entityId: rental.id,
      title: "Equipment rental overdue",
      body: `Your rental of ${rental.equipment.name} (${rental.rentalReference}) is overdue for return.`,
    }));

    await this.notifyManyIfNotExists("EQUIPMENT", "EquipmentRental", candidates);
  }

  private async generateLockerReminders(now: Date): Promise<void> {
    const expiringRentals = await prisma.lockerRental.findMany({
      where: {
        status: "ACTIVE",
        endAt: { gte: now, lte: addDays(now, LOCKER_REMINDER_WINDOW_DAYS) },
      },
      include: { locker: { select: { code: true } }, player: { select: { userId: true } } },
    });

    const candidates: ReminderCandidate[] = expiringRentals.map((rental) => ({
      userId: rental.player.userId,
      entityId: rental.id,
      title: "Locker rental expiring soon",
      body: `Your rental of locker ${rental.locker.code} (${rental.rentalReference}) expires on ${rental.endAt.toLocaleDateString()}.`,
    }));

    await this.notifyManyIfNotExists("LOCKER", "LockerRental", candidates);
  }

  // Phase 10: batched — one query to find which of this sweep's candidate
  // (userId, entityId) pairs already have a notification, one createMany
  // for the rest, instead of a findFirst+create pair per row (confirmed
  // O(rows) round-trips per sweep, run on every notification-bell open by
  // any signed-in user). Dedupe key is still userId+type+entityType+
  // entityId, matching the schema's index exactly — same correctness as
  // before, just batched.
  private async notifyManyIfNotExists(
    type: NotificationType,
    entityType: string,
    candidates: ReminderCandidate[],
  ): Promise<void> {
    if (candidates.length === 0) {
      return;
    }

    const entityIds = Array.from(new Set(candidates.map((candidate) => candidate.entityId)));
    const existing = await prisma.notification.findMany({
      where: { type, entityType, entityId: { in: entityIds } },
      select: { userId: true, entityId: true },
    });

    const existingKeys = new Set(existing.map((n) => `${n.userId}:${n.entityId}`));
    const seenKeys = new Set<string>();

    const rows = candidates.filter((candidate) => {
      const key = `${candidate.userId}:${candidate.entityId}`;
      if (existingKeys.has(key) || seenKeys.has(key)) {
        return false;
      }
      seenKeys.add(key);
      return true;
    });

    if (rows.length === 0) {
      return;
    }

    await prisma.notification.createMany({
      data: rows.map((candidate) => ({
        userId: candidate.userId,
        type,
        entityType,
        entityId: candidate.entityId,
        title: candidate.title,
        body: candidate.body,
      })),
    });
  }
}

export const notificationService = new NotificationService();
