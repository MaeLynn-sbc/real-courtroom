import type {
  CreateOpenPlaySessionInput,
  RegisterForSessionInput,
} from "@/features/open-play/schemas/open-play.schema";
import type { OpenPlaySession, Prisma } from "@/lib/generated/prisma/client";
import type { OpenPlaySessionStatus } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
import { queueService } from "@/services/open-play/queue.service";
import { formatSessionReference } from "@/services/open-play/session-reference";
import { canTransitionSessionStatus } from "@/services/open-play/session-status";

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

interface ListSessionsFilters {
  status?: OpenPlaySessionStatus;
}

// A registration "holds a capacity slot" once it's REGISTERED or
// CHECKED_IN (checking in doesn't free the slot it already occupied).
const SLOT_HOLDING_STATUSES = ["REGISTERED", "CHECKED_IN"] as const;

export class OpenPlaySessionService {
  async listSessions(filters?: ListSessionsFilters) {
    return prisma.openPlaySession.findMany({
      where: filters?.status ? { status: filters.status } : undefined,
      orderBy: { startAt: "desc" },
    });
  }

  async listSessionHistory() {
    return prisma.openPlaySession.findMany({
      where: { status: { in: ["COMPLETED", "CANCELLED"] } },
      orderBy: { startAt: "desc" },
    });
  }

  async getSessionById(sessionId: string) {
    return prisma.openPlaySession.findUnique({
      where: { id: sessionId },
      include: {
        registrations: {
          include: {
            player: { include: { user: { select: { id: true, name: true, email: true } } } },
            queueEntry: true,
          },
          orderBy: { registeredAt: "asc" },
        },
      },
    });
  }

  // v1.1 maintenance: sessionReference now comes from the shared atomic
  // counter (lib/reference-counter.ts), so it can no longer collide — no
  // retry loop is needed.
  async createSession(
    input: CreateOpenPlaySessionInput,
    actorUserId: string,
  ): Promise<OpenPlaySession> {
    const now = new Date();
    const sequence = await nextSequence(dailyScope("OPEN_PLAY_SESSION", now));
    const sessionReference = formatSessionReference(now, sequence);

    const session = await prisma.openPlaySession.create({
      data: {
        sessionReference,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        capacity: input.capacity,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play.session_created",
      entityType: "OpenPlaySession",
      entityId: session.id,
      newValues: session,
    });

    return session;
  }

  async updateSession(
    sessionId: string,
    input: CreateOpenPlaySessionInput,
    actorUserId: string,
  ): Promise<OpenPlaySession> {
    const existing = await prisma.openPlaySession.findUniqueOrThrow({ where: { id: sessionId } });

    const session = await prisma.openPlaySession.update({
      where: { id: sessionId },
      data: {
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        capacity: input.capacity,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play.session_updated",
      entityType: "OpenPlaySession",
      entityId: session.id,
      oldValues: existing,
      newValues: session,
    });

    return session;
  }

  async updateSessionStatus(
    sessionId: string,
    status: OpenPlaySessionStatus,
    actorUserId: string,
  ): Promise<OpenPlaySession> {
    const existing = await prisma.openPlaySession.findUniqueOrThrow({ where: { id: sessionId } });

    if (!canTransitionSessionStatus(existing.status, status)) {
      throw new Error(`Cannot move an Open Play session from ${existing.status} to ${status}.`);
    }

    const session = await prisma.openPlaySession.update({
      where: { id: sessionId },
      data: { status },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play.session_status_changed",
      entityType: "OpenPlaySession",
      entityId: session.id,
      oldValues: { status: existing.status },
      newValues: { status: session.status },
    });

    return session;
  }

  async registerForSession(
    sessionId: string,
    input: RegisterForSessionInput,
    actorUserId: string,
  ) {
    const session = await prisma.openPlaySession.findUniqueOrThrow({ where: { id: sessionId } });

    const slotsHeld = await prisma.openPlayRegistration.count({
      where: { openPlaySessionId: sessionId, status: { in: [...SLOT_HOLDING_STATUSES] } },
    });

    const status = slotsHeld < session.capacity ? "REGISTERED" : "WAITLISTED";

    const registration = await prisma.openPlayRegistration.create({
      data: {
        openPlaySessionId: sessionId,
        playerId: input.playerId,
        guestName: input.guestName,
        guestPhone: input.guestPhone,
        status,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play.registered",
      entityType: "OpenPlayRegistration",
      entityId: registration.id,
      newValues: registration,
    });

    return registration;
  }

  async cancelRegistration(registrationId: string, actorUserId: string) {
    const existing = await prisma.openPlayRegistration.findUniqueOrThrow({
      where: { id: registrationId },
    });

    const registration = await prisma.openPlayRegistration.update({
      where: { id: registrationId },
      data: { status: "CANCELLED" },
    });

    const queueEntry = await queueService.getQueueEntryByRegistrationId(registrationId);
    if (queueEntry) {
      await queueService.removeFromQueue(queueEntry.id);
    }

    if ((SLOT_HOLDING_STATUSES as readonly string[]).includes(existing.status)) {
      await queueService.promoteFromWaitlist(existing.openPlaySessionId);
    }

    await this.writeAuditLog({
      actorUserId,
      action: "open_play.registration_cancelled",
      entityType: "OpenPlayRegistration",
      entityId: registration.id,
      oldValues: { status: existing.status },
      newValues: { status: registration.status },
    });

    return registration;
  }

  async checkInRegistration(registrationId: string, actorUserId: string) {
    const existing = await prisma.openPlayRegistration.findUniqueOrThrow({
      where: { id: registrationId },
    });

    if (existing.status !== "REGISTERED") {
      throw new Error("Only a registered (non-waitlisted) player can check in.");
    }

    const registration = await prisma.openPlayRegistration.update({
      where: { id: registrationId },
      data: { status: "CHECKED_IN", checkedInAt: new Date() },
    });

    await queueService.addToQueue(existing.openPlaySessionId, registrationId);

    await this.writeAuditLog({
      actorUserId,
      action: "open_play.checked_in",
      entityType: "OpenPlayRegistration",
      entityId: registration.id,
      newValues: { status: registration.status, checkedInAt: registration.checkedInAt },
    });

    return registration;
  }

  async markNoShow(registrationId: string, actorUserId: string) {
    const existing = await prisma.openPlayRegistration.findUniqueOrThrow({
      where: { id: registrationId },
    });

    const registration = await prisma.openPlayRegistration.update({
      where: { id: registrationId },
      data: { status: "NO_SHOW" },
    });

    if ((SLOT_HOLDING_STATUSES as readonly string[]).includes(existing.status)) {
      await queueService.promoteFromWaitlist(existing.openPlaySessionId);
    }

    await this.writeAuditLog({
      actorUserId,
      action: "open_play.marked_no_show",
      entityType: "OpenPlayRegistration",
      entityId: registration.id,
      oldValues: { status: existing.status },
      newValues: { status: registration.status },
    });

    return registration;
  }

  async getAttendance(sessionId: string) {
    return prisma.openPlayRegistration.findMany({
      where: { openPlaySessionId: sessionId },
      include: {
        player: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
      orderBy: { registeredAt: "asc" },
    });
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

export const openPlaySessionService = new OpenPlaySessionService();
