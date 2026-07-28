import type {
  CreatePlayerInput,
  SearchPlayersInput,
  UpdatePlayerInput,
} from "@/features/players/schemas/player.schema";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { SaleCategory } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { mergeTimelineEvents, type PlayerTimelineEvent } from "@/services/player/player-timeline";
import { SYSTEM_ROLES } from "@/types/roles";

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

interface AuditLogEntry {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

const playerWithUser = {
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.PlayerInclude;

const SALE_CATEGORY_LABELS: Record<SaleCategory, string> = {
  BOOKING: "Booking",
  MEMBERSHIP: "Membership",
  EQUIPMENT_RENTAL: "Equipment rental",
  LOCKER_RENTAL: "Locker rental",
  TOURNAMENT_REGISTRATION: "Tournament registration",
  PRODUCT: "Product",
  OPEN_PLAY: "Open play",
  COACHING: "Coaching",
  OTHER: "Other",
};

export class PlayerService {
  // Unchanged signature/behavior — Booking's, Open Play's, and
  // Tournament's registration forms already depend on this exact method.
  async listPlayers() {
    return prisma.player.findMany({
      where: { deletedAt: null },
      include: playerWithUser,
      orderBy: { user: { name: "asc" } },
      // Defensive cap, not real pagination (this feeds registration-form
      // pickers across Booking/Open Play/Tournament, which want the whole
      // list to search client-side, not a paginated view) — high enough
      // that it never matters at this app's actual scale, just a backstop
      // against an unbounded query as the roster grows.
      //
      // KNOWN STOPGAP, not a real fix: this is ordered alphabetically by
      // name, so once the roster passes this cap, whoever sorts after it
      // silently stops appearing in every picker built on this method —
      // no error, no indication, they just become unfindable by search.
      // Raised from 200 to 1000 (2026-07-29) as a deliberately cheap
      // stopgap, not a solution — chosen specifically because the real
      // fix is a meaningfully bigger change: replacing this "fetch
      // everything, filter client-side" pattern with live server-side
      // search (playerService.searchPlayers already exists and does a
      // real database `contains` query, no cap). That rework changes
      // PlayerSearchCombobox's prop contract (a static players: T[] array
      // becomes an onSearch callback) across both its callers — New
      // Booking's player field and open-play walk-in registration — and
      // needs a loading state plus request-sequencing (an older, slower
      // response must not clobber a newer one) that don't exist today,
      // for a limit this venue isn't remotely close to. Revisit the real
      // fix once the roster is genuinely approaching four figures, not
      // before.
      take: 1000,
    });
  }

  async getPlayerById(playerId: string) {
    return prisma.player.findUnique({
      where: { id: playerId },
      include: {
        ...playerWithUser,
        rating: true,
        memberships: {
          include: { membershipPlan: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
  }

  async searchPlayers(input: SearchPlayersInput) {
    const where: Prisma.PlayerWhereInput = { deletedAt: null };

    if (input.skillLevel) {
      where.skillLevel = input.skillLevel;
    }

    if (input.query) {
      where.user = {
        OR: [
          { name: { contains: input.query, mode: "insensitive" } },
          { email: { contains: input.query, mode: "insensitive" } },
        ],
      };
    }

    if (input.hasActiveMembership === true) {
      where.memberships = { some: { status: "ACTIVE" } };
    } else if (input.hasActiveMembership === false) {
      where.memberships = { none: { status: "ACTIVE" } };
    }

    return prisma.player.findMany({
      where,
      include: playerWithUser,
      orderBy: { user: { name: "asc" } },
      take: 200,
    });
  }

  // Always creates a fresh User + Player pair (roleId = Member) — there is
  // no flow for attaching a Player profile to an existing staff User.
  async createPlayer(input: CreatePlayerInput, actorUserId: string) {
    const memberRole = await prisma.role.findUniqueOrThrow({
      where: { name: SYSTEM_ROLES.MEMBER },
    });

    const player = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: input.name, email: input.email, roleId: memberRole.id },
      });

      return tx.player.create({
        data: {
          userId: user.id,
          phone: input.phone,
          bio: input.bio,
          dateOfBirth: input.dateOfBirth,
          skillLevel: input.skillLevel,
          openPlaySkillLevel: input.openPlaySkillLevel,
          dominantHand: input.dominantHand,
          position: input.position,
        },
        include: playerWithUser,
      });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "player.created",
      entityType: "Player",
      entityId: player.id,
      newValues: player,
    });

    return player;
  }

  async updatePlayer(playerId: string, input: UpdatePlayerInput, actorUserId: string) {
    const existing = await prisma.player.findUniqueOrThrow({ where: { id: playerId } });

    const player = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.userId },
        data: { name: input.name, email: input.email },
      });

      return tx.player.update({
        where: { id: playerId },
        data: {
          phone: input.phone,
          bio: input.bio,
          dateOfBirth: input.dateOfBirth,
          skillLevel: input.skillLevel,
          openPlaySkillLevel: input.openPlaySkillLevel,
          dominantHand: input.dominantHand,
          position: input.position,
        },
        include: playerWithUser,
      });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "player.updated",
      entityType: "Player",
      entityId: player.id,
      oldValues: existing,
      newValues: player,
    });

    return player;
  }

  async deletePlayer(playerId: string, actorUserId: string) {
    const player = await prisma.player.update({
      where: { id: playerId },
      data: { deletedAt: new Date() },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "player.deleted",
      entityType: "Player",
      entityId: player.id,
    });

    return player;
  }

  // Merges Bookings, Open Play registrations, Tournament registrations,
  // and Membership history into one chronological feed — this is both
  // "Player history" and the recommended "Player Timeline," the same
  // feature under two names.
  async getPlayerTimeline(playerId: string): Promise<PlayerTimelineEvent[]> {
    const [bookings, openPlayRegistrations, teams, membershipHistoryEntries, sales] = await Promise.all([
      prisma.booking.findMany({
        where: { playerId },
        include: { court: true },
        orderBy: { startAt: "desc" },
        take: 50,
      }),
      prisma.openPlayRegistration.findMany({
        where: { playerId },
        include: { openPlaySession: true },
        orderBy: { registeredAt: "desc" },
        take: 50,
      }),
      prisma.team.findMany({
        where: { OR: [{ player1Id: playerId }, { player2Id: playerId }] },
        include: {
          tournamentRegistrations: {
            include: { tournamentCategory: { include: { tournament: true } } },
          },
        },
      }),
      prisma.membershipHistory.findMany({
        where: { membership: { playerId } },
        include: { membershipPlan: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.sale.findMany({
        where: { playerId },
        include: { paymentMethod: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    const events: PlayerTimelineEvent[] = [];

    for (const booking of bookings) {
      events.push({
        type: "BOOKING",
        occurredAt: booking.startAt,
        title: `Booked ${booking.court.name}`,
        description: `${booking.status} — ${booking.bookingReference}`,
      });
    }

    for (const registration of openPlayRegistrations) {
      events.push({
        type: "OPEN_PLAY_REGISTRATION",
        occurredAt: registration.registeredAt,
        title: `Registered for Open Play ${registration.openPlaySession.sessionReference}`,
        description: registration.status,
      });
    }

    for (const team of teams) {
      for (const registration of team.tournamentRegistrations) {
        events.push({
          type: "TOURNAMENT_REGISTRATION",
          occurredAt: registration.registeredAt,
          title: `Registered for ${registration.tournamentCategory.tournament.name} — ${registration.tournamentCategory.name}`,
          description: registration.status,
        });
      }
    }

    for (const entry of membershipHistoryEntries) {
      events.push({
        type: "MEMBERSHIP_EVENT",
        occurredAt: entry.createdAt,
        title: `${entry.eventType}${entry.membershipPlan ? ` — ${entry.membershipPlan.name}` : ""}`,
        description: entry.note ?? undefined,
      });
    }

    for (const sale of sales) {
      events.push({
        type: "SALE",
        occurredAt: sale.createdAt,
        title: `${formatCurrency(sale.amountCents)} — ${SALE_CATEGORY_LABELS[sale.category]}`,
        description: `${sale.paymentMethod.label} — ${sale.saleNumber}`,
      });
    }

    return mergeTimelineEvents(events);
  }

  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          oldValues: toJsonValue(entry.oldValues),
          newValues: toJsonValue(entry.newValues),
        },
      });
    } catch (error) {
      logger.error(
        { err: error, action: entry.action, userId: entry.actorUserId },
        "Failed to write audit log entry",
      );
    }
  }
}

export const playerService = new PlayerService();
