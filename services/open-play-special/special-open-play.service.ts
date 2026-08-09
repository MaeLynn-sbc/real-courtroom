import type { SpecialOpenPlayCheckIn } from "@/lib/generated/prisma/client";
import type { SkillLevel, SpecialStagedSlot } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

export const SPECIAL_STAGED_SLOTS = ["NEXT_UP", "AFTER_THAT", "THEN"] as const;

function isSpecialStagedSlot(value: string): value is SpecialStagedSlot {
  return (SPECIAL_STAGED_SLOTS as readonly string[]).includes(value);
}

// Owner request (2026-08-09): "an outside special court" — see
// prisma/schema.prisma's own comment on SpecialOpenPlayCheckIn for the
// full isolation rationale. Explicitly temporary and simple: check in,
// manually group up to 4 players onto one of three court slots, mark a
// game done, repeat. No auto-pairing, no staging pipeline, no nudge
// timers, no Sale, no PlayerTab, no add-ons — none of that machinery is
// imported here. The one addition (2026-08-09, same day): a manual
// "Announce" button per court, watched by the isolated /specialtv
// display (services/display/special-display.service.ts) — its own
// display, its own URL, no connection to the real Open Play TV.
export const SPECIAL_COURT_LABELS = ["Court 1", "Court 2", "Court 3"] as const;
export type SpecialCourtLabel = (typeof SPECIAL_COURT_LABELS)[number];

// A real foursome — same cap Open Play itself uses for a group.
const MAX_PLAYERS_PER_COURT = 4;

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

  // Groups 1-4 waiting players onto one court at once ("form a group and
  // put it to Court 1") — claims every row in the same atomic UPDATE
  // (id IN checkInIds AND status = WAITING), so a partial claim can only
  // ever mean some of the requested players were already taken by a
  // different assignment between the capacity check and this call, not
  // a half-applied group; that's reported as a clear error, not silently
  // left ambiguous. A temporary tool for a human clicking one button at
  // a time, not a high-throughput system — this is a reasonable, honest
  // level of race protection for that, not a full row-locked transaction
  // the way the real booking/rotation engines need.
  async assignGroupToCourt(checkInIds: string[], courtLabel: string): Promise<void> {
    if (!isSpecialCourtLabel(courtLabel)) {
      throw new Error(`Unknown court "${courtLabel}".`);
    }
    if (checkInIds.length === 0) {
      throw new Error("Select at least one player.");
    }
    if (checkInIds.length > MAX_PLAYERS_PER_COURT) {
      throw new Error(`A court can only hold ${MAX_PLAYERS_PER_COURT} players.`);
    }

    const targets = await prisma.specialOpenPlayCheckIn.findMany({
      where: { id: { in: checkInIds } },
    });
    if (targets.length !== checkInIds.length) {
      throw new Error("One of the selected players no longer exists — refresh and try again.");
    }
    if (targets.some((t) => t.status !== "WAITING")) {
      throw new Error("One of the selected players is no longer waiting — refresh and try again.");
    }
    const date = targets[0].date;
    if (targets.some((t) => t.date.getTime() !== date.getTime())) {
      throw new Error("Selected players must all be checked in for the same date.");
    }

    const occupantCount = await prisma.specialOpenPlayCheckIn.count({
      where: { date, status: "PLAYING", courtLabel },
    });
    if (occupantCount + checkInIds.length > MAX_PLAYERS_PER_COURT) {
      throw new Error(
        `${courtLabel} only has room for ${MAX_PLAYERS_PER_COURT - occupantCount} more player(s).`,
      );
    }

    const claim = await prisma.specialOpenPlayCheckIn.updateMany({
      where: { id: { in: checkInIds }, status: "WAITING" },
      // Clearing stagedSlot here (unconditionally — harmless if it was
      // already null) is what makes "send a staged Next up/After
      // that/Then group straight to a court" work for free: the admin
      // board just calls this same method with that slot's member ids.
      data: { status: "PLAYING", courtLabel, startedAt: new Date(), stagedSlot: null },
    });
    if (claim.count !== checkInIds.length) {
      throw new Error("Some of these players were already assigned by someone else — refresh and try again.");
    }
  }

  // Manual staging only ("can we also add next up. then next then" —
  // explicitly no AUTO_QUEUE source, see this model's own schema
  // comment). Incremental, same capacity-check shape as
  // assignGroupToCourt — a slot can be topped up one player (or one
  // group) at a time up to 4, not just filled once and then locked
  // until cleared ("can i manually add player" — staff can keep adding
  // to Next up/After that/Then as more people check in).
  async stageGroup(checkInIds: string[], slot: string): Promise<void> {
    if (!isSpecialStagedSlot(slot)) {
      throw new Error(`Unknown staging slot "${slot}".`);
    }
    if (checkInIds.length === 0) {
      throw new Error("Select at least one player.");
    }
    if (checkInIds.length > MAX_PLAYERS_PER_COURT) {
      throw new Error(`A group can only hold ${MAX_PLAYERS_PER_COURT} players.`);
    }

    const targets = await prisma.specialOpenPlayCheckIn.findMany({
      where: { id: { in: checkInIds } },
    });
    if (targets.length !== checkInIds.length) {
      throw new Error("One of the selected players no longer exists — refresh and try again.");
    }
    if (targets.some((t) => t.status !== "WAITING" || t.stagedSlot !== null)) {
      throw new Error("One of the selected players is no longer waiting, or is already staged — refresh and try again.");
    }
    const date = targets[0].date;
    if (targets.some((t) => t.date.getTime() !== date.getTime())) {
      throw new Error("Selected players must all be checked in for the same date.");
    }

    const existingCount = await prisma.specialOpenPlayCheckIn.count({
      where: { date, stagedSlot: slot, status: "WAITING" },
    });
    if (existingCount + checkInIds.length > MAX_PLAYERS_PER_COURT) {
      throw new Error(
        `That slot only has room for ${MAX_PLAYERS_PER_COURT - existingCount} more player(s).`,
      );
    }

    const claim = await prisma.specialOpenPlayCheckIn.updateMany({
      where: { id: { in: checkInIds }, status: "WAITING", stagedSlot: null },
      data: { stagedSlot: slot },
    });
    if (claim.count !== checkInIds.length) {
      throw new Error("Some of these players were already taken by someone else — refresh and try again.");
    }
  }

  // "can i manually add player" (in every staging box) — check a new
  // player straight into a slot in one step, instead of checking in via
  // the top form and then separately selecting + staging them. Same two
  // real writes as doing it by hand (checkIn, then stageGroup), just
  // combined behind one button.
  async checkInAndStage(
    date: Date,
    input: SpecialOpenPlayCheckInInput,
    slot: string,
    actorUserId: string,
  ): Promise<SpecialOpenPlayCheckIn> {
    const created = await this.checkIn(date, input, actorUserId);
    await this.stageGroup([created.id], slot);
    return prisma.specialOpenPlayCheckIn.findUniqueOrThrow({ where: { id: created.id } });
  }

  // Un-stage a slot's group back to plain Waiting.
  async clearStagedSlot(date: Date, slot: string): Promise<void> {
    if (!isSpecialStagedSlot(slot)) {
      throw new Error(`Unknown staging slot "${slot}".`);
    }
    const claim = await prisma.specialOpenPlayCheckIn.updateMany({
      where: { date, stagedSlot: slot, status: "WAITING" },
      data: { stagedSlot: null },
    });
    if (claim.count === 0) {
      throw new Error("Nothing is staged in that slot.");
    }
  }

  // Frees the whole court and returns every occupant to Waiting for
  // another round — "mark a game done, repeat."
  async completeCourtGame(date: Date, courtLabel: string): Promise<void> {
    const claim = await prisma.specialOpenPlayCheckIn.updateMany({
      where: { date, courtLabel, status: "PLAYING" },
      data: { status: "WAITING", courtLabel: null },
    });
    if (claim.count === 0) {
      throw new Error(`${courtLabel} has nobody currently playing.`);
    }
  }

  // Manual "Announce" — stamps every current occupant of the court with
  // the same fresh timestamp; the /specialtv display diffs this per
  // court to decide when to speak. Freely re-triggerable (no
  // "already announced" guard), same shape as Open Play's own manual
  // Announce button.
  async announceCourt(date: Date, courtLabel: string): Promise<void> {
    if (!isSpecialCourtLabel(courtLabel)) {
      throw new Error(`Unknown court "${courtLabel}".`);
    }
    const claim = await prisma.specialOpenPlayCheckIn.updateMany({
      where: { date, courtLabel, status: "PLAYING" },
      data: { announcementRequestedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new Error(`${courtLabel} has nobody currently playing to announce.`);
    }
  }

  // Separate "Time's up" cue — "call if the time is up" — stamps every
  // current occupant of the court together, same shape as announceCourt but
  // its own field/message so staff can warn a court before actually
  // freeing it via completeCourtGame.
  async announceTimesUp(date: Date, courtLabel: string): Promise<void> {
    if (!isSpecialCourtLabel(courtLabel)) {
      throw new Error(`Unknown court "${courtLabel}".`);
    }
    const claim = await prisma.specialOpenPlayCheckIn.updateMany({
      where: { date, courtLabel, status: "PLAYING" },
      data: { timesUpRequestedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new Error(`${courtLabel} has nobody currently playing to notify.`);
    }
  }

  // Leaving entirely — from Waiting or Playing (freeing their court seat
  // too, without necessarily ending the rest of the group's game).
  async checkOut(checkInId: string): Promise<SpecialOpenPlayCheckIn> {
    const claim = await prisma.specialOpenPlayCheckIn.updateMany({
      where: { id: checkInId, status: { in: ["WAITING", "PLAYING"] } },
      data: { status: "DONE", courtLabel: null, stagedSlot: null, doneAt: new Date() },
    });
    if (claim.count === 0) {
      throw new Error("This check-in has already left.");
    }
    return prisma.specialOpenPlayCheckIn.findUniqueOrThrow({ where: { id: checkInId } });
  }
}

export const specialOpenPlayService = new SpecialOpenPlayService();
