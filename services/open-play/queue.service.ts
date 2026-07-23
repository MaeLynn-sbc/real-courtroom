import type { OpenPlayQueue } from "@/lib/generated/prisma/client";
import type { OpenPlayQueueStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

// Sole owner of OpenPlayQueue + OpenPlayQueueHistory writes. Every status
// change goes through setPlaying/setResting/setWaiting so the history log
// stays complete — rotation-engine.ts calls into these rather than
// touching Prisma directly, keeping database access behind the service
// layer per the architecture's layering rule.
export class QueueService {
  async getQueue(sessionId: string) {
    return prisma.openPlayQueue.findMany({
      where: { openPlaySessionId: sessionId },
      include: {
        registration: {
          include: {
            player: { include: { user: { select: { id: true, name: true, email: true } } } },
          },
        },
        court: true,
      },
      orderBy: [{ status: "asc" }, { queuePosition: "asc" }],
    });
  }

  async getQueueEntryByRegistrationId(registrationId: string) {
    return prisma.openPlayQueue.findUnique({ where: { registrationId } });
  }

  // Idempotent — if the registration already has a queue entry (e.g. a
  // double-submitted check-in), returns the existing one instead of
  // failing on the unique registrationId constraint.
  async addToQueue(sessionId: string, registrationId: string): Promise<OpenPlayQueue> {
    const existing = await prisma.openPlayQueue.findUnique({ where: { registrationId } });
    if (existing) {
      return existing;
    }

    const queuePosition = await this.nextWaitingPosition(sessionId);

    const queueEntry = await prisma.openPlayQueue.create({
      data: {
        openPlaySessionId: sessionId,
        registrationId,
        status: "WAITING",
        queuePosition,
      },
    });

    await this.recordHistory(queueEntry.id, "WAITING", null);

    return queueEntry;
  }

  async removeFromQueue(queueId: string): Promise<void> {
    await prisma.openPlayQueue.delete({ where: { id: queueId } });
  }

  async setPlaying(queueId: string, courtId: string): Promise<OpenPlayQueue> {
    const queueEntry = await prisma.openPlayQueue.update({
      where: { id: queueId },
      data: { status: "PLAYING", courtId, stateChangedAt: new Date() },
    });
    await this.recordHistory(queueEntry.id, "PLAYING", courtId);
    return queueEntry;
  }

  async setResting(queueId: string): Promise<OpenPlayQueue> {
    const queueEntry = await prisma.openPlayQueue.update({
      where: { id: queueId },
      data: { status: "RESTING", courtId: null, stateChangedAt: new Date() },
    });
    await this.recordHistory(queueEntry.id, "RESTING", null);
    return queueEntry;
  }

  // Tail-reinsertion: a returning player goes to the back of the current
  // Waiting queue, not their old position.
  async setWaiting(queueId: string): Promise<OpenPlayQueue> {
    const existing = await prisma.openPlayQueue.findUniqueOrThrow({ where: { id: queueId } });
    const queuePosition = await this.nextWaitingPosition(existing.openPlaySessionId);

    const queueEntry = await prisma.openPlayQueue.update({
      where: { id: queueId },
      data: { status: "WAITING", courtId: null, queuePosition, stateChangedAt: new Date() },
    });
    await this.recordHistory(queueEntry.id, "WAITING", null);
    return queueEntry;
  }

  // Flips the oldest WAITLISTED registration for the session to
  // REGISTERED when a spot frees up (a registration cancellation).
  // Does not touch the queue itself — the promoted player still needs to
  // check in before joining the Waiting queue, same as any other
  // registration.
  async promoteFromWaitlist(sessionId: string) {
    const nextWaitlisted = await prisma.openPlayRegistration.findFirst({
      where: { openPlaySessionId: sessionId, status: "WAITLISTED" },
      orderBy: { registeredAt: "asc" },
    });

    if (!nextWaitlisted) {
      return null;
    }

    return prisma.openPlayRegistration.update({
      where: { id: nextWaitlisted.id },
      data: { status: "REGISTERED" },
    });
  }

  private async nextWaitingPosition(sessionId: string): Promise<number> {
    const result = await prisma.openPlayQueue.aggregate({
      where: { openPlaySessionId: sessionId, status: "WAITING" },
      _max: { queuePosition: true },
    });
    return (result._max.queuePosition ?? 0) + 1;
  }

  private async recordHistory(
    queueId: string,
    status: OpenPlayQueueStatus,
    courtId: string | null,
  ): Promise<void> {
    await prisma.openPlayQueueHistory.create({
      data: { queueId, status, courtId },
    });
  }
}

export const queueService = new QueueService();
