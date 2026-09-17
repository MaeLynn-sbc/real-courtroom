import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { gameChargeDescription } from "@/lib/game-charge-description";
import { isPracticeDate, practiceDate } from "@/lib/practice";
import { prisma } from "@/lib/prisma";
import { getPlacementsForDate } from "@/services/open-play/player-placement";
import { settingsService } from "@/services/settings/settings.service";

// Practice mode — see lib/practice.ts for why it lives on a fixed date
// and why it can never touch money.

// Sample names for "Add sample players": ten per skill level, distinct
// first names so each reads clearly on the TV ("Ana T."). Every one ends
// in "Test" so nobody mistakes them for customers.
const SAMPLE_NAMES: Record<OpenPlaySkillLevel, string[]> = {
  BEGINNER: ["Ana", "Ben", "Cai", "Dee", "Eli", "Fay", "Gio", "Hana", "Ivy", "Jon"],
  NOVICE: ["Kat", "Leo", "Mia", "Nico", "Olga", "Pat", "Quin", "Rhea", "Sol", "Tess"],
  INTERMEDIATE: ["Uma", "Vic", "Wes", "Xia", "Yuri", "Zed", "Abby", "Bryce", "Cleo", "Dino"],
  ADVANCED: ["Ezra", "Faith", "Gabe", "Hugo", "Iris", "Jade", "Kobe", "Luna", "Milo", "Nora"],
};

export const SAMPLE_PLAYERS_PER_LEVEL = 10;

export interface PracticeBill {
  registrationId: string;
  playerName: string;
  placement: string | null;
  skillLevel: OpenPlaySkillLevel;
  items: { id: string; description: string; amountCents: number }[];
  totalCents: number;
}

export class PracticeService {
  // Owner (2026-09-17): "add test name players, 10 for each category".
  // Adds whichever sample names aren't already in practice, interleaved by
  // level (Beginner, Novice, Intermediate, Advanced, Beginner, ...) so the
  // line reads like a real mixed night. Safe to press twice.
  async addSamplePlayers(actorUserId: string) {
    const existing = new Set(
      (
        await prisma.openPlayNightRegistration.findMany({
          where: { date: practiceDate() },
          select: { playerName: true },
        })
      ).map((r) => r.playerName),
    );
    const levels = Object.keys(SAMPLE_NAMES) as OpenPlaySkillLevel[];
    let added = 0;
    for (let i = 0; i < SAMPLE_PLAYERS_PER_LEVEL; i += 1) {
      for (const skillLevel of levels) {
        const playerName = `${SAMPLE_NAMES[skillLevel][i]} Test`;
        if (existing.has(playerName)) continue;
        await this.addPracticePlayer({ playerName, skillLevel }, actorUserId);
        added += 1;
      }
    }
    return { added };
  }

  // A typed sample name goes straight into the practice queue. No Player
  // row, no name matching, no check-in (check-in is what opens a tab),
  // no sale. The phone is left blank: it is a practice name, not a
  // person.
  async addPracticePlayer(
    input: { playerName: string; skillLevel: OpenPlaySkillLevel },
    actorUserId: string,
  ) {
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

    await this.audit(actorUserId, "practice.player_added", registration.id, {
      playerName,
      skillLevel: input.skillLevel,
    });
    return registration;
  }

  // Removes one practice name and everything it touched.
  async removePracticePlayer(registrationId: string, actorUserId: string) {
    const registration = await prisma.openPlayNightRegistration.findUniqueOrThrow({
      where: { id: registrationId },
    });
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
      await tx.gameAssignment.deleteMany({
        where: { id: { in: assignmentIds }, date: registration.date },
      });
      await tx.recentPairing.deleteMany({
        where: {
          date: registration.date,
          OR: [{ registrationIdA: registrationId }, { registrationIdB: registrationId }],
        },
      });
      await tx.queueEntry.deleteMany({ where: { registrationId } });
      await tx.openPlayNightRegistration.delete({ where: { id: registrationId } });
      // A staged group left with nobody in it is removed too.
      await tx.stagedGroup.deleteMany({
        where: { date: registration.date, queueEntries: { none: {} } },
      });
    });
    await this.audit(actorUserId, "practice.player_removed", registrationId, {
      playerName: registration.playerName,
    });
  }

  // Wipes every practice row: games, staged sets, the queue, the names.
  async clearPractice(actorUserId: string) {
    const date = practiceDate();
    const counts = await prisma.$transaction(async (tx) => {
      const registrations = await tx.openPlayNightRegistration.findMany({
        where: { date },
        select: { id: true },
      });
      const ids = registrations.map((r) => r.id);
      // Defensive: a practice registration should never have a tab, but
      // if one ever appeared its line items must go before it does.
      const tabs = await tx.playerTab.findMany({
        where: { registrationId: { in: ids } },
        select: { id: true },
      });
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

  // Mock settle (owner, 2026-09-17: "where's the names when they want to
  // settle"). What each practice player WOULD owe for their finished
  // practice games at tonight's weeknight rate, itemised like a real
  // tab. Read-only: nothing is stored, nothing can be paid, no sale.
  async getPracticeBills(): Promise<PracticeBill[]> {
    const date = practiceDate();
    const [registrations, settings] = await Promise.all([
      prisma.openPlayNightRegistration.findMany({
        where: { date },
        orderBy: { playerName: "asc" },
        select: {
          id: true,
          playerName: true,
          skillLevel: true,
          gameAssignmentEntries: {
            where: { assignment: { status: "DONE" } },
            select: {
              assignment: {
                select: {
                  id: true,
                  startedAt: true,
                  endedAt: true,
                  court: { select: { name: true } },
                },
              },
            },
            orderBy: { assignment: { startedAt: "asc" } },
          },
        },
      }),
      settingsService.getOpenPlaySettings(),
    ]);
    const rate = settings.weeknightGameRateCents;
    const placements = await getPlacementsForDate(date);
    // Every practice player is listed, like the real Settle list, with
    // where they are now; games appear as they finish.
    return registrations.map((r) => ({
      registrationId: r.id,
      playerName: r.playerName,
      placement: placements.get(r.id) ?? null,
      skillLevel: r.skillLevel,
      items: r.gameAssignmentEntries.map(({ assignment }) => ({
        id: assignment.id,
        description: gameChargeDescription({
          courtName: assignment.court.name,
          startedAt: assignment.startedAt,
          endedAt: assignment.endedAt,
        }),
        amountCents: rate,
      })),
      totalCents: rate * r.gameAssignmentEntries.length,
    }));
  }

  async setTakeoverRtv(value: boolean, actorUserId: string) {
    await settingsService.setPracticeTakeoverRtv(value, actorUserId);
  }

  private async audit(
    actorUserId: string,
    action: string,
    entityId: string | null,
    newValues: object,
  ) {
    try {
      await prisma.auditLog.create({
        data: {
          userId: actorUserId,
          action,
          entityType: "Practice",
          entityId,
          newValues: newValues as never,
        },
      });
    } catch (error) {
      logger.error({ err: error, action }, "Failed to write practice audit log entry");
    }
  }
}

export const practiceService = new PracticeService();
