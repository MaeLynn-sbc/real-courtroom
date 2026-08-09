import type { SpecialOpenPlayCheckIn } from "@/lib/generated/prisma/client";
import type { SkillLevel } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

// Owner request (2026-08-09): "an outside special court" — see
// prisma/schema.prisma's own comment on SpecialOpenPlayCheckIn for the
// full isolation rationale. Explicitly temporary and simple: check in,
// manually assign to one of three court slots, mark a game done, repeat.
// No auto-pairing, no staging pipeline, no nudge timers, no Sale, no
// PlayerTab, no add-ons, no TV/announce connection — none of that
// machinery is imported here, on purpose.
export const SPECIAL_COURT_LABELS = ["Court A", "Court B", "Court C"] as const;
export type SpecialCourtLabel = (typeof SPECIAL_COURT_LABELS)[number];

function isSpecialCourtLabel(value: string): value is SpecialCourtLabel {
  return (SPECIAL_COURT_LABELS as readonly string[]).includes(value);
}

export interface SpecialOpenPlayCheckInInput {
  playerName: string;
  phone?: string;
  skillLevel?: SkillLevel;
}

export class SpecialOpenPlayService {
  async listForDate(date: Date): Promise<SpecialOpenPlayCheckIn[]> {
    return prisma.specialOpenPlayCheckIn.findMany({
      where: { date, status: { in: ["WAITING", "PLAYING"] } },
      orderBy: { checkedInAt: "asc" },
    });
  }

  async checkIn(
    date: Date,
    input: SpecialOpenPlayCheckInInput,
    actorUserId: string,
  ): Promise<SpecialOpenPlayCheckIn> {
    const playerName = input.playerName.trim();
    if (!playerName) {
      throw new Error("Enter a name.");
    }

    return prisma.specialOpenPlayCheckIn.create({
      data: {
        date,
        playerName,
        phone: input.phone?.trim() || undefined,
        skillLevel: input.skillLevel,
        status: "WAITING",
        createdByUserId: actorUserId,
      },
    });
  }

  // Claims the target row atomically (WAITING -> PLAYING, no separate
  // read-then-write on the row itself), after confirming the requested
  // court isn't already occupied for this date — a temporary tool for a
  // human clicking one button at a time, not a high-throughput system;
  // this is a reasonable, honest level of race protection for that, not
  // a full row-locked transaction the way the real booking/rotation
  // engines need.
  async assignToCourt(checkInId: string, courtLabel: string): Promise<SpecialOpenPlayCheckIn> {
    if (!isSpecialCourtLabel(courtLabel)) {
      throw new Error(`Unknown court "${courtLabel}".`);
    }

    const target = await prisma.specialOpenPlayCheckIn.findUniqueOrThrow({ where: { id: checkInId } });
    if (target.status !== "WAITING") {
      throw new Error(`Can't assign a check-in that's currently ${target.status.toLowerCase()}.`);
    }

    const occupied = await prisma.specialOpenPlayCheckIn.findFirst({
      where: { date: target.date, status: "PLAYING", courtLabel },
    });
    if (occupied) {
      throw new Error(`${courtLabel} is already occupied by ${occupied.playerName}.`);
    }

    const claim = await prisma.specialOpenPlayCheckIn.updateMany({
      where: { id: checkInId, status: "WAITING" },
      data: { status: "PLAYING", courtLabel, startedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new Error("This check-in was already assigned by someone else — refresh and try again.");
    }

    return prisma.specialOpenPlayCheckIn.findUniqueOrThrow({ where: { id: checkInId } });
  }

  // Frees the court and returns the player to Waiting for another round
  // — "mark a game done, repeat."
  async completeGame(checkInId: string): Promise<SpecialOpenPlayCheckIn> {
    const claim = await prisma.specialOpenPlayCheckIn.updateMany({
      where: { id: checkInId, status: "PLAYING" },
      data: { status: "WAITING", courtLabel: null },
    });
    if (claim.count === 0) {
      throw new Error("This check-in isn't currently playing.");
    }
    return prisma.specialOpenPlayCheckIn.findUniqueOrThrow({ where: { id: checkInId } });
  }

  // Leaving entirely — from Waiting or Playing (freeing the court too).
  async checkOut(checkInId: string): Promise<SpecialOpenPlayCheckIn> {
    const claim = await prisma.specialOpenPlayCheckIn.updateMany({
      where: { id: checkInId, status: { in: ["WAITING", "PLAYING"] } },
      data: { status: "DONE", courtLabel: null, doneAt: new Date() },
    });
    if (claim.count === 0) {
      throw new Error("This check-in has already left.");
    }
    return prisma.specialOpenPlayCheckIn.findUniqueOrThrow({ where: { id: checkInId } });
  }
}

export const specialOpenPlayService = new SpecialOpenPlayService();
