import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { isPracticeDate, practiceDate } from "@/lib/practice";
import { prisma } from "@/lib/prisma";
import { settingsService } from "@/services/settings/settings.service";

// Practice mode — see lib/practice.ts for why it lives on a fixed date
// and why it can never touch money.

export class PracticeService {
  // A typed sample name goes straight into the practice queue. No Player
  // row, no name matching, no check-in (check-in is what opens a tab),
  // no sale. The phone is left blank: it is a practice name, not a
  // person.
  async addPracticePlayer(input: { playerName: string; skillLevel: OpenPlaySkillLevel }, actorUserId: string) {
    const playerName = input.playerName.trim().replace(/\s+/g, " ");
    if (!playerName) throw new Error("Enter a name.");
    const date = practiceDate();
    const now = new Date();

    const registration = await prisma.$transaction(async (tx) => {
      const created = await tx.openPlayNightRegistration.create({
        data: {
          date,
          sessionId: null,
          playerId: null,
          playerName,
          phone: "",
          skillLevel: input.skillLevel,
          source: "WALK_IN",
          status: "CONFIRMED",
          checkedInAt: now,
        },
      });
      await tx.queueEntry.create({
        data: {
          registrationId: created.id,
          sessionId: null,
          date,
          playerName,
          skillLevel: input.skillLevel,
          partyId: null,
          joinedQueueAt: now,
        },
      });
      return created;
    });

    await this.audit(actorUserId, "practice.player_added", registration.id, { playerName, skillLevel: input.skillLevel });
    return registration;
  }

  // Removes one practice name and everything it touched.
  async removePracticePlayer(registrationId: string, actorUserId: string) {
    const registration = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: registrationId } });
    if (!isPracticeDate(registration.date)) {
      throw new Error("That is a real registration, not a practice player.");
    }
    await prisma.$transaction(async (tx) => {
      const participations = await tx.gameAssignmentParticipant.findMany({
        where: { registrationId },
        select: { assignmentId: true },
      });
      const assignmentIds = participations.map((p) => p.assignmentId);
      // A game that player was in is practice data too: drop it whole so
      // no court is left holding a half-empty practice game.
      await tx.gameAssignment.deleteMany({ where: { id: { in: assignmentIds }, date: registration.date } });
      await tx.recentPairing.deleteMany({
        where: { date: registration.date, OR: [{ registrationIdA: registrationId }, { registrationIdB: registrationId }] },
      });
      await tx.queueEntry.deleteMany({ where: { registrationId } });
      await tx.openPlayNightRegistration.delete({ where: { id: registrationId } });
      // A staged group left with nobody in it is removed too.
      await tx.stagedGroup.deleteMany({ where: { date: registration.date, queueEntries: { none: {} } } });
    });
    await this.audit(actorUserId, "practice.player_removed", registrationId, { playerName: registration.playerName });
  }

  // Wipes every practice row: games, staged sets, the queue, the names.
  async clearPractice(actorUserId: string) {
    const date = practiceDate();
    const counts = await prisma.$transaction(async (tx) => {
      const registrations = await tx.openPlayNightRegistration.findMany({ where: { date }, select: { id: true } });
      const ids = registrations.map((r) => r.id);
      // Defensive: a practice registration should never have a tab, but
      // if one ever appeared its line items must go before it does.
      const tabs = await tx.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
      await tx.tabLineItem.deleteMany({ where: { tabId: { in: tabs.map((t) => t.id) } } });
      await tx.playerTab.deleteMany({ where: { id: { in: tabs.map((t) => t.id) } } });
      const games = await tx.gameAssignment.deleteMany({ where: { date } });
      await tx.recentPairing.deleteMany({ where: { date } });
      await tx.queueEntry.deleteMany({ where: { date } });
      await tx.stagedGroup.deleteMany({ where: { date } });
      const players = await tx.openPlayNightRegistration.deleteMany({ where: { id: { in: ids } } });
      return { games: games.count, players: players.count };
    });
    await this.audit(actorUserId, "practice.cleared", null, counts);
    return counts;
  }

  async setTakeoverRtv(value: boolean, actorUserId: string) {
    await settingsService.setPracticeTakeoverRtv(value, actorUserId);
  }

  private async audit(actorUserId: string, action: string, entityId: string | null, newValues: object) {
    try {
      await prisma.auditLog.create({
        data: { userId: actorUserId, action, entityType: "Practice", entityId, newValues: newValues as never },
      });
    } catch (error) {
      logger.error({ err: error, action }, "Failed to write practice audit log entry");
    }
  }
}

export const practiceService = new PracticeService();
