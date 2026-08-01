import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type {
  Court,
  GameAssignment,
  GameAssignmentParticipant,
  OpenPlayNightRegistration,
  Prisma,
  QueueEntry,
} from "@/lib/generated/prisma/client";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";
import { noopRaceHook, type RaceHook } from "@/lib/race-test-hooks";
import { openPlayRegistrationService } from "@/services/open-play/open-play-registration.service";
import { playerTabService } from "@/services/open-play/player-tab.service";
import { settingsService } from "@/services/settings/settings.service";
import { OPEN_PLAY_SKILL_LEVELS } from "@/types/open-play-skill-levels";

// BUILD-SPEC.md §7. Distinctly named from the old, dormant
// services/open-play/rotation-engine.ts (see schema.prisma's comment above
// GameAssignment for why) — that file belongs to the OpenPlaySession
// feature (FEATURE_OPEN_PLAY=false), not this one. Do not import from it or
// reuse its types.

interface AuditLogEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function skillOrder(level: OpenPlaySkillLevel): number {
  return OPEN_PLAY_SKILL_LEVELS[level].order;
}

// A "unit" is what actually moves through rotation as one piece: a solo
// waiting player, or a party (2-4 members) that entered the queue together
// (BUILD-SPEC.md §7 "Parties"). Assignment math (anchor, candidates,
// skill window) all operates on units, not raw QueueEntry rows, so a party
// is never split across courts.
interface QueueUnitMember {
  queueEntryId: string;
  registrationId: string;
  playerName: string;
  skillLevel: OpenPlaySkillLevel;
  sessionId: string | null;
}

interface QueueUnit {
  partyId: string | null;
  members: QueueUnitMember[];
  // QueueEntry.joinedQueueAt directly — the LAST member's check-in for a
  // party (§6), i.e. the moment the party actually became playable. An
  // earlier "earliest member" version of this used to leapfrog solos who
  // were playable the whole time a party was still assembling: a party
  // isn't playable until everyone's arrived, so it can't have been
  // "waiting to play" before then. §5's waitlist rule (earliest member)
  // answers a different question — claiming a capacity seat, not turn
  // order in a live rotation — and stays separate; see BUILD-SPEC.md §7.
  // For a solo unit this is simply its own check-in time.
  effectiveWaitStart: Date;
  // Own skill level for a solo unit; the party's AVERAGE skill order (§7
  // "Skill matching uses the party's average skill") for a party unit.
  effectiveSkill: number;
}

export interface GameAssignmentWithParticipants extends GameAssignment {
  participants: (GameAssignmentParticipant & { registration: OpenPlayNightRegistration })[];
}

export interface RotationBoardCourt {
  court: Court;
  active: GameAssignmentWithParticipants | null;
  proposed: GameAssignmentWithParticipants | null;
}

export interface RotationBoardUnit {
  partyId: string | null;
  members: QueueUnitMember[];
  waitMinutes: number;
  pastMaxWait: boolean;
}

export interface RotationBoardRestingPlayer {
  queueEntryId: string;
  registrationId: string;
  playerName: string;
  skillLevel: OpenPlaySkillLevel;
}

export interface RotationBoardData {
  courts: RotationBoardCourt[];
  waiting: RotationBoardUnit[];
  // Resting players are deliberately excluded from `waiting` (they skip
  // rotation, §7) — listed separately so the board can still offer a way
  // back in (markWaitingAgain), the only reverse path out of RESTING.
  resting: RotationBoardRestingPlayer[];
  maxWaitMinutes: number;
  // Manual timer/announce: the rotation-board.tsx staff screen isn't a
  // live-polling view (unlike the TV/phone displays) — it re-renders on
  // each staff action or manual reload, so page.tsx computes the actual
  // "waiting to start" boolean itself at that moment, the same way it
  // already computes everything else here. This is just the raw setting,
  // passed through once rather than fetched a second time (getOpenPlaySettings
  // is already called above for maxWaitMinutes).
  forgottenAssignmentNudgeMinutes: number;
  // Non-null only when a court is actually free AND 4+ players are
  // waiting AND no valid foursome can currently be assembled from them —
  // e.g. two parties of 3 with no solos. Parties never split, so this is
  // a real deadlock, not "not enough people yet" (which is simply not
  // reported here — that's the normal, unremarkable idle state).
  unfillableQueueReason: string | null;
}

async function fetchWaitingUnits(
  date: Date,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<QueueUnit[]> {
  const entries = await client.queueEntry.findMany({
    where: { date, status: "WAITING" },
    orderBy: { joinedQueueAt: "asc" },
  });

  const soloUnits: QueueUnit[] = [];
  const partyGroups = new Map<string, typeof entries>();

  for (const entry of entries) {
    if (!entry.partyId) {
      soloUnits.push({
        partyId: null,
        members: [
          {
            queueEntryId: entry.id,
            registrationId: entry.registrationId,
            playerName: entry.playerName,
            skillLevel: entry.skillLevel,
            sessionId: entry.sessionId,
          },
        ],
        effectiveWaitStart: entry.joinedQueueAt,
        effectiveSkill: skillOrder(entry.skillLevel),
      });
      continue;
    }
    const group = partyGroups.get(entry.partyId) ?? [];
    group.push(entry);
    partyGroups.set(entry.partyId, group);
  }

  const partyUnits: QueueUnit[] = [];
  for (const [partyId, group] of partyGroups) {
    // Defensive — BUILD-SPEC.md §7 "Parties larger than 4 are rejected with
    // a clear message." Registration-time joins should already prevent
    // this; a group this large here means state got corrupted upstream, so
    // this unit is excluded from rotation rather than silently overfilling
    // a doubles court.
    if (group.length > 4) {
      logger.error(
        { partyId, size: group.length, date },
        "Party larger than 4 in rotation queue — excluding from proposals",
      );
      continue;
    }
    // All members of a party share the same joinedQueueAt — created
    // together, in the same transaction, the moment the last member
    // checked in (§6) — so any member's value is the party's.
    const averageSkill =
      group.reduce((sum, entry) => sum + skillOrder(entry.skillLevel), 0) / group.length;

    partyUnits.push({
      partyId,
      members: group.map((entry) => ({
        queueEntryId: entry.id,
        registrationId: entry.registrationId,
        playerName: entry.playerName,
        skillLevel: entry.skillLevel,
        sessionId: entry.sessionId,
      })),
      effectiveWaitStart: group[0].joinedQueueAt,
      effectiveSkill: averageSkill,
    });
  }

  return [...soloUnits, ...partyUnits];
}

function orderedPairKey(idA: string, idB: string): [string, string] {
  return idA < idB ? [idA, idB] : [idB, idA];
}

async function fetchRecentPairingCounts(
  date: Date,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Map<string, number>> {
  const rows = await client.recentPairing.findMany({ where: { date } });
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(`${row.registrationIdA}:${row.registrationIdB}`, row.gameCount);
  }
  return map;
}

function pairingCountBetweenUnits(
  a: QueueUnit,
  b: QueueUnit,
  pairingCounts: Map<string, number>,
): number {
  let total = 0;
  for (const memberA of a.members) {
    for (const memberB of b.members) {
      const [idA, idB] = orderedPairKey(memberA.registrationId, memberB.registrationId);
      total += pairingCounts.get(`${idA}:${idB}`) ?? 0;
    }
  }
  return total;
}

// Pure assembly logic shared by proposeNextAssignment (which then persists
// the result) and checkQueueFillability (which only needs to know whether
// it *would* succeed, to warn staff before they even try). Returns null if
// there aren't 4 waiting players, or if the available units can't be
// packed into exactly 4 seats even after widening to any skill level —
// e.g. two parties of 3 and no solos: 6 people waiting, but neither party
// fits into the other's single remaining seat, and parties are never
// split. That specific shape is a real deadlock, not a rare edge case —
// see checkQueueFillability, which is what surfaces it to staff.
async function assembleFoursome(
  units: QueueUnit[],
  settings: { skillWindow: number },
  date: Date,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ anchor: QueueUnit; selected: QueueUnit[] } | null> {
  const totalWaiting = units.reduce((sum, unit) => sum + unit.members.length, 0);
  if (totalWaiting < 4) {
    return null;
  }

  // Step 1: anchor — the unit waiting longest. Never highest skill, never
  // random (§7). Because this always picks the single oldest
  // effectiveWaitStart across every waiting unit, on every call, the
  // starvation guard (§7 step 4: nobody waits past maxWaitMinutes) holds
  // by construction — whichever player has waited longest is always the
  // next one anchored, regardless of skill fit. See
  // open-play-rotation.integration.ts for the required test.
  const sortedByWait = [...units].sort(
    (a, b) => a.effectiveWaitStart.getTime() - b.effectiveWaitStart.getTime(),
  );
  const anchor = sortedByWait[0];

  if (anchor.members.length > 4) {
    throw new Error(`Anchor unit has ${anchor.members.length} members — doubles only, max 4.`);
  }

  let remainingSeats = 4 - anchor.members.length;
  const selected: QueueUnit[] = [];

  if (remainingSeats > 0) {
    const pairingCounts = await fetchRecentPairingCounts(date, client);
    let pool = sortedByWait.filter((unit) => unit !== anchor);

    // Step 2/3: candidates within skill distance 1 of the anchor, ranked
    // by wait time — widen to distance 2, then any level, so a court
    // never sits idle for a "perfect" match (§7 step 3). Step 5 (repeat
    // softening) breaks ties within a tier: among units at the same
    // widening distance, prefer ones without a recent pairing against the
    // anchor before falling back to wait time — a soft tiebreak only,
    // never a reason to skip a longer-waiting candidate for a shorter
    // one it just hasn't recently played.
    const tiers = [settings.skillWindow, settings.skillWindow + 1, Infinity];
    for (const maxDistance of tiers) {
      if (remainingSeats === 0) break;

      const eligible = pool
        .filter((unit) => Math.abs(unit.effectiveSkill - anchor.effectiveSkill) <= maxDistance)
        .sort((a, b) => {
          const pairingA = pairingCountBetweenUnits(anchor, a, pairingCounts);
          const pairingB = pairingCountBetweenUnits(anchor, b, pairingCounts);
          if (pairingA !== pairingB) return pairingA - pairingB;
          return a.effectiveWaitStart.getTime() - b.effectiveWaitStart.getTime();
        });

      for (const unit of eligible) {
        if (unit.members.length > remainingSeats) continue;
        selected.push(unit);
        remainingSeats -= unit.members.length;
        pool = pool.filter((u) => u !== unit);
        if (remainingSeats === 0) break;
      }
    }
  }

  if (remainingSeats > 0) {
    // Could not pack exactly 4 seats from the available unit shapes.
    return null;
  }

  return { anchor, selected };
}

// Distinct from a generic "invalid state" error — a staff member
// double-tapping "complete" (or a slow connection retrying) is expected
// to hit this, not a real bug. Same named-error precedent as
// shift.service.ts's ShiftAlreadyOpenError. The action layer catches this
// specifically and returns a benign no-op instead of an error toast — see
// completeAssignmentAction.
export class AssignmentAlreadyCompletedError extends Error {
  constructor(assignmentId: string) {
    super(`Assignment ${assignmentId} was already completed.`);
    this.name = "AssignmentAlreadyCompletedError";
  }
}

export class OpenPlayRotationService {
  // BUILD-SPEC.md §7 "Auto-pairing." Called when a court frees up.
  //
  // Hardening phase fix (BUILD-SPEC.md §0 process rule): the waiting-
  // players read and the assignment-creating write used to run in
  // separate transactions/queries. Two concurrent proposals — even for
  // two different courts — could both read the same waiting pool before
  // either wrote, letting the same registration end up a participant in
  // two simultaneous GameAssignments. Proven live before this fix
  // (open-play-rotation.concurrency.integration.ts): 2 concurrent calls
  // for 2 different courts, pool of 5 waiting players, both "succeeded"
  // with the identical 4 players double-booked onto both courts, every
  // run. Fixed the same way as completeAssignment: lock the rows that
  // own the invariant — every currently-WAITING QueueEntry for this date
  // — before reading them, so a concurrent call for the same date blocks
  // until this transaction commits, then re-reads and correctly excludes
  // whoever this call already selected.
  //
  // LOCK-ORDER WARNING (BUILD-SPEC.md §15 "canonical lock order"): this
  // method locks QueueEntry, then INSERTs a new GameAssignment via
  // createAssignmentTx — the opposite of completeAssignment/
  // cancelAssignmentTx's GameAssignment-then-QueueEntry order. That's
  // only safe because createAssignmentTx flips every participant's
  // QueueEntry.status to PLAYING in the SAME transaction that creates
  // the GameAssignment row (see that method's own comment) — a WAITING
  // row this method could lock can never be the same row an active
  // assignment is touching. If proposal is ever split into two
  // transactions (e.g. "tentatively select, then create the
  // GameAssignment later"), that atomicity breaks and this becomes a
  // real deadlock risk under contention, not just a nominal one. Do not
  // split this into two transactions without re-deriving §15's
  // lock-order exception first.
  async proposeNextAssignment(
    date: Date,
    courtId: string,
    actorUserId: string | null,
  ): Promise<GameAssignmentWithParticipants | null> {
    const settings = await settingsService.getOpenPlaySettings();

    const created = await prisma.$transaction(async (tx) => {
      // ORDER BY id (BUILD-SPEC.md §15 "canonical lock order"): two
      // concurrent proposals for the same date lock this identical row
      // set: without a stable order, differing query plans could in
      // principle lock them in different sequences and deadlock instead
      // of one simply queueing behind the other. Same defensive pattern
      // as checkIn's party-member lock.
      await tx.$queryRaw`SELECT id FROM "QueueEntry" WHERE date = ${date} AND status = 'WAITING' ORDER BY id FOR UPDATE`;

      const units = await fetchWaitingUnits(date, tx);
      const result = await assembleFoursome(units, settings, date, tx);
      if (!result) {
        return null;
      }

      const participantUnits = [result.anchor, ...result.selected];
      const participantMembers = participantUnits.flatMap((unit) => unit.members);
      const skillLevels = participantMembers.map((member) => skillOrder(member.skillLevel));
      const skillSpread = Math.max(...skillLevels) - Math.min(...skillLevels);
      const sessionId = participantMembers[0]?.sessionId ?? null;

      return this.createAssignmentTx(
        tx,
        {
          date,
          courtId,
          sessionId,
          skillSpread,
          source: "AUTO",
          createdByUserId: null,
          registrationIds: participantMembers.map((m) => m.registrationId),
        },
        actorUserId,
      );
    });

    if (created) {
      await this.writeAuditLog({
        actorUserId,
        action: "game_assignment.proposed",
        entityType: "GameAssignment",
        entityId: created.id,
        newValues: {
          source: "AUTO",
          courtId,
          registrationIds: created.participants.map((p) => p.registrationId),
        },
      });
    }

    return created;
  }

  // BUILD-SPEC.md §7 "Manual override — staff can always overrule." Staff
  // picks exactly 4 waiting players by hand, skill ignored entirely. "When
  // staff override, the auto-proposal is discarded, not queued behind" —
  // if any target court, or any of the 4 chosen players, is already part
  // of a PROPOSED (not yet confirmed) assignment, that proposal is
  // cancelled and its other participants freed back to WAITING first. A
  // player already ACTIVE (mid-game) cannot be pulled — that's a real
  // conflict, not a discardable proposal.
  async createManualAssignment(
    date: Date,
    courtId: string,
    registrationIds: string[],
    actorUserId: string,
  ): Promise<GameAssignmentWithParticipants> {
    // Reported live: doubles (4) is still the normal case, but a court
    // with 2 or 3 players (early mornings, a short-handed group) is
    // real, valid ₱35/game play, not an error — see this method's own
    // early-return-free billing (playerTabService.creditGame is called
    // once per participant, so 2 players correctly means 2×₱35, not a
    // split ₱140). The AUTOMATIC skill-matching path
    // (assembleFoursome/proposeNextAssignment) still requires exactly 4
    // — that rule is untouched, this guard is manual-only.
    if (registrationIds.length < 2 || registrationIds.length > 4) {
      throw new Error("Pick 2 to 4 players for a manual group.");
    }
    if (new Set(registrationIds).size !== registrationIds.length) {
      throw new Error("A player can't be picked twice for the same group.");
    }

    return prisma.$transaction(async (tx) => {
      const entries = await tx.queueEntry.findMany({
        where: { registrationId: { in: registrationIds }, date },
      });
      if (entries.length !== registrationIds.length) {
        throw new Error("One or more selected players aren't in today's queue.");
      }
      for (const entry of entries) {
        if (entry.status === "PLAYING") {
          const existingParticipant = await tx.gameAssignmentParticipant.findFirst({
            where: { registrationId: entry.registrationId },
            include: { assignment: true },
            orderBy: { createdAt: "desc" },
          });
          if (existingParticipant?.assignment.status === "ACTIVE") {
            throw new Error(
              `${entry.playerName} is already mid-game — finish or cancel that game first.`,
            );
          }
          if (existingParticipant?.assignment.status === "PROPOSED") {
            await this.cancelAssignmentTx(tx, existingParticipant.assignment.id);
          }
        } else if (entry.status !== "WAITING") {
          throw new Error(
            `${entry.playerName} isn't waiting (status: ${entry.status.toLowerCase()}).`,
          );
        }
      }

      const existingCourtProposal = await tx.gameAssignment.findFirst({
        where: { courtId, date, status: "PROPOSED" },
      });
      if (existingCourtProposal) {
        await this.cancelAssignmentTx(tx, existingCourtProposal.id);
      }

      const skillLevels = entries.map((entry) => skillOrder(entry.skillLevel));
      const skillSpread = Math.max(...skillLevels) - Math.min(...skillLevels);
      const sessionId = entries[0]?.sessionId ?? null;

      return this.createAssignmentTx(
        tx,
        {
          date,
          courtId,
          sessionId,
          skillSpread,
          source: "MANUAL",
          createdByUserId: actorUserId,
          registrationIds,
        },
        actorUserId,
      );
    });
  }

  async confirmAssignment(
    assignmentId: string,
    actorUserId: string,
  ): Promise<GameAssignmentWithParticipants> {
    const assignment = await prisma.gameAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
    });
    if (assignment.status !== "PROPOSED") {
      throw new Error(
        `Only a proposed assignment can be confirmed (current status: ${assignment.status}).`,
      );
    }

    const updated = await prisma.gameAssignment.update({
      where: { id: assignmentId },
      data: { status: "ACTIVE", startedAt: new Date() },
      include: { participants: { include: { registration: true } } },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "game_assignment.confirmed",
      entityType: "GameAssignment",
      entityId: assignmentId,
    });

    return updated;
  }

  // Manual timer/announce (reported live): players take time to walk to
  // their court, so auto-starting the clock and auto-announcing the
  // instant a foursome is assigned shorted them part of their 15 minutes.
  // Deliberately separate from confirmAssignment/startedAt below —
  // announcing (players walk over) and starting the timer (players are on
  // court) are two different staff decisions with a gap between them, not
  // one bundled step. Re-pressable (a fresh timestamp each time, no
  // "already announced" guard) — nobody heard it the first time, or a
  // no-show needs re-calling, are both legitimate reasons to press this
  // again. Works on PROPOSED (the normal case — announce, then start) or
  // ACTIVE (a legitimate re-announce after the timer's already running),
  // but not DONE/CANCELLED — nothing to announce for a game that's over.
  async announceAssignment(
    assignmentId: string,
    actorUserId: string,
  ): Promise<GameAssignmentWithParticipants> {
    const assignment = await prisma.gameAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
    });
    if (assignment.status !== "PROPOSED" && assignment.status !== "ACTIVE") {
      throw new Error(
        `Can't announce an assignment that's already ${assignment.status.toLowerCase()}.`,
      );
    }

    const updated = await prisma.gameAssignment.update({
      where: { id: assignmentId },
      data: { announcementRequestedAt: new Date() },
      include: { participants: { include: { registration: true } } },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "game_assignment.announced",
      entityType: "GameAssignment",
      entityId: assignmentId,
    });

    return updated;
  }

  // "Time's up" — the twin of announceAssignment above, for calling
  // players OFF the court instead of onto it. Deliberately manual, not
  // clock-driven (same reasoning as the ANNOUNCE button itself): staff
  // can see whether players noticed and cleared the court, so a call
  // that fires automatically at zero would go off whether or not it's
  // actually needed. ACTIVE only — PROPOSED has no running clock yet,
  // so "time's up" is meaningless there (unlike ANNOUNCE, which is
  // valid on both).
  async announceTimesUp(
    assignmentId: string,
    actorUserId: string,
  ): Promise<GameAssignmentWithParticipants> {
    const assignment = await prisma.gameAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
    });
    if (assignment.status !== "ACTIVE") {
      throw new Error(
        `Can only call time's up on an active game (current status: ${assignment.status.toLowerCase()}).`,
      );
    }

    const updated = await prisma.gameAssignment.update({
      where: { id: assignmentId },
      data: { timesUpRequestedAt: new Date() },
      include: { participants: { include: { registration: true } } },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "game_assignment.times_up_announced",
      entityType: "GameAssignment",
      entityId: assignmentId,
    });

    return updated;
  }

  // Handles both "reject a proposal" and "cancel a game in progress" — in
  // both cases nobody actually finished a game, so participants return to
  // WAITING with joinedQueueAt untouched (BUILD-SPEC.md doesn't specify a
  // wait-time penalty for a voided game, and resetting it would punish
  // players for a staff-side decision, not their own play).
  // `testOnlyRaceHook` is the permanent seam BUILD-SPEC.md §15 requires:
  // never passed by any real caller (every production call site omits it,
  // defaulting to a no-op), invoked only by
  // open-play-rotation.concurrency.integration.ts to prove the FOR UPDATE
  // lock below is load-bearing rather than merely present.
  async cancelAssignment(
    assignmentId: string,
    actorUserId: string,
    testOnlyRaceHook: RaceHook = noopRaceHook,
  ): Promise<GameAssignmentWithParticipants> {
    const result = await prisma.$transaction((tx) =>
      this.cancelAssignmentTx(tx, assignmentId, testOnlyRaceHook),
    );

    await this.writeAuditLog({
      actorUserId,
      action: "game_assignment.cancelled",
      entityType: "GameAssignment",
      entityId: assignmentId,
    });

    return result;
  }

  // Hardening phase fix (BUILD-SPEC.md §0 process rule): did not take the
  // same FOR UPDATE lock completeAssignment does. A concurrent
  // cancelAssignment could read status=ACTIVE, then block on
  // completeAssignment's lock while completeAssignment finished crediting
  // and committed DONE, then unblock and blindly overwrite DONE back to
  // CANCELLED — with the games already billed. Same fix as
  // completeAssignment — lock the row that owns the invariant before
  // reading it, so a concurrent completeAssignment and cancelAssignment for
  // the same assignment can't both act on a stale read of the other's
  // in-flight change.
  private async cancelAssignmentTx(
    tx: Prisma.TransactionClient,
    assignmentId: string,
    testOnlyRaceHook: RaceHook = noopRaceHook,
  ): Promise<GameAssignmentWithParticipants> {
    await tx.$queryRaw`SELECT id FROM "GameAssignment" WHERE id = ${assignmentId} FOR UPDATE`;

    const assignment = await tx.gameAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: { participants: true },
    });
    if (assignment.status !== "PROPOSED" && assignment.status !== "ACTIVE") {
      throw new Error(`Cannot cancel an assignment with status ${assignment.status}.`);
    }

    // Widens the gap between the status check above and the write below —
    // a no-op when the FOR UPDATE lock above is present (this transaction
    // already holds exclusive access to the row, so a concurrent
    // completeAssignment is blocked at lock acquisition, not waiting on
    // this hook). If that lock line is ever removed, this hook gives a
    // concurrent completeAssignment real wall-clock time to run to
    // completion in the gap, reproducing the corruption instead of relying
    // on independent async calls happening to line up.
    await testOnlyRaceHook();

    await tx.queueEntry.updateMany({
      where: { registrationId: { in: assignment.participants.map((p) => p.registrationId) } },
      data: { status: "WAITING" },
    });

    return tx.gameAssignment.update({
      where: { id: assignmentId },
      data: { status: "CANCELLED" },
      include: { participants: { include: { registration: true } } },
    });
  }

  // BUILD-SPEC.md §7 "After a game — All 4 return to the queue with
  // joinedQueueAt reset and gamesPlayed incremented." Also records
  // RecentPairing for every pair among the 4 (§7's soft repeat-avoidance
  // signal) and never touches capacity/waitlist — that's markDone below.
  async completeAssignment(
    assignmentId: string,
    actorUserId: string,
  ): Promise<GameAssignmentWithParticipants> {
    const result = await prisma.$transaction(async (tx) => {
      // Row lock BEFORE reading status — closes a real race: two
      // concurrent completeAssignment calls for the same assignment can
      // both read status=ACTIVE before either commits (proven live —
      // player-tab.concurrency.integration.ts failed with 10/10 calls
      // succeeding and a 10x credit before this lock existed). Same
      // established technique as open-play-registration.service.ts's
      // lockSessionRow — the row that owns the invariant being protected
      // (here, "DONE happens at most once") gets locked before the check.
      //
      // A database-level uniqueness constraint can't do this job instead:
      // creditGame's idempotency check needs to distinguish an active GAME
      // credit from a voided one, and voids are separate, append-only
      // ADJUSTMENT rows (TabLineItem.voidsLineItemId), not a flag on the
      // original — see that field's schema.prisma comment. A partial
      // unique index's WHERE predicate can only see the row being
      // inserted's own columns, not whether some OTHER row later
      // references it as voided, so "unique among non-voided credits"
      // isn't expressible as an index at all. Serializing at the true
      // point of contention — the ACTIVE-to-DONE transition itself, which
      // only ever happens once per assignment by construction — is what
      // makes creditGame's application-level check sufficient.
      await tx.$queryRaw`SELECT id FROM "GameAssignment" WHERE id = ${assignmentId} FOR UPDATE`;

      const assignment = await tx.gameAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
        include: { participants: true },
      });
      // DONE specifically is the benign case — a double-tap or a losing
      // concurrent call after the lock above forces the rest to wait and
      // re-read. PROPOSED/CANCELLED are genuine misuse (completing a game
      // that was never confirmed, or was called off) and stay a real error.
      if (assignment.status === "DONE") {
        throw new AssignmentAlreadyCompletedError(assignmentId);
      }
      if (assignment.status !== "ACTIVE") {
        throw new Error(
          `Only an active assignment can be completed (current status: ${assignment.status}).`,
        );
      }

      const now = new Date();
      const registrationIds = assignment.participants.map((p) => p.registrationId);

      await tx.queueEntry.updateMany({
        where: { registrationId: { in: registrationIds } },
        data: {
          status: "WAITING",
          joinedQueueAt: now,
          lastPlayedAt: now,
          gamesPlayed: { increment: 1 },
        },
      });

      for (let i = 0; i < registrationIds.length; i++) {
        for (let j = i + 1; j < registrationIds.length; j++) {
          const [idA, idB] = orderedPairKey(registrationIds[i], registrationIds[j]);
          await tx.recentPairing.upsert({
            where: {
              date_registrationIdA_registrationIdB: {
                date: assignment.date,
                registrationIdA: idA,
                registrationIdB: idB,
              },
            },
            update: { gameCount: { increment: 1 } },
            create: {
              date: assignment.date,
              registrationIdA: idA,
              registrationIdB: idB,
              gameCount: 1,
            },
          });
        }
      }

      // BUILD-SPEC.md §9 "Every GameAssignment reaching status done credits
      // one game to each of its 4 players" — billed here, in the same
      // transaction as the DONE transition, so a game can't be marked done
      // without being billed (or vice versa). A cancelled assignment never
      // reaches this code, satisfying §9 correctness #4 ("voided
      // assignments credit no games and bill nothing") by construction.
      for (const registrationId of registrationIds) {
        await playerTabService.creditGame(registrationId, assignmentId, tx);
      }

      return tx.gameAssignment.update({
        where: { id: assignmentId },
        data: { status: "DONE", endedAt: now },
        include: { participants: { include: { registration: true } } },
      });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "game_assignment.completed",
      entityType: "GameAssignment",
      entityId: assignmentId,
    });

    return result;
  }

  // BUILD-SPEC.md §7 "Staff can mark a player resting (skips rotations,
  // stays registered)." Only valid from WAITING — a player mid-game must
  // have their assignment completed/cancelled first.
  async markResting(queueEntryId: string, actorUserId: string): Promise<QueueEntry> {
    const entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: queueEntryId } });
    if (entry.status !== "WAITING") {
      throw new Error(
        `Can only rest a player who is waiting (current status: ${entry.status.toLowerCase()}).`,
      );
    }
    const updated = await prisma.queueEntry.update({
      where: { id: queueEntryId },
      data: { status: "RESTING" },
    });
    await this.writeAuditLog({
      actorUserId,
      action: "queue_entry.rested",
      entityType: "QueueEntry",
      entityId: queueEntryId,
    });
    return updated;
  }

  // Minimal counterpart to markResting so staff can bring a resting player
  // back into rotation — not explicitly named in §7, but "resting... stays
  // registered" implies it's reversible, and there's no other way back in.
  async markWaitingAgain(queueEntryId: string, actorUserId: string): Promise<QueueEntry> {
    const entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: queueEntryId } });
    if (entry.status !== "RESTING") {
      throw new Error(
        `Can only un-rest a resting player (current status: ${entry.status.toLowerCase()}).`,
      );
    }
    const updated = await prisma.queueEntry.update({
      where: { id: queueEntryId },
      data: { status: "WAITING" },
    });
    await this.writeAuditLog({
      actorUserId,
      action: "queue_entry.waiting_again",
      entityType: "QueueEntry",
      entityId: queueEntryId,
    });
    return updated;
  }

  // Queue reorder (reported live): a forming group short a fourth wants a
  // specific, LATER-queued player — normal open play (groups form around
  // who wants to play together), not a fairness bug. Staff need to move
  // that whole unit to sit right after the wanted player; everyone
  // between the unit's old and new spot should advance automatically.
  // No new position column needed: wait order has always been pure
  // joinedQueueAt (see fetchWaitingUnits above), so "move after X" is
  // exactly "set joinedQueueAt to just after X's" — the same mechanism
  // completeAssignment already uses to send a just-finished player to
  // the back (now(), the latest possible value; this is the general
  // case, an arbitrary later point instead of always "now"). Everyone
  // else's row is untouched, so they advance for free — nothing to
  // compute, nothing to renumber.
  async moveQueueUnitAfter(
    date: Date,
    movingRegistrationIds: string[],
    targetRegistrationId: string,
    actorUserId: string,
  ): Promise<void> {
    if (movingRegistrationIds.length === 0) {
      throw new Error("Select at least one player to move.");
    }
    if (movingRegistrationIds.includes(targetRegistrationId)) {
      throw new Error("Can't move a group to sit after itself.");
    }

    await prisma.$transaction(async (tx) => {
      const target = await tx.queueEntry.findFirst({
        where: { date, registrationId: targetRegistrationId, status: "WAITING" },
      });
      if (!target) {
        throw new Error("That player isn't currently waiting.");
      }

      const movers = await tx.queueEntry.findMany({
        where: { date, registrationId: { in: movingRegistrationIds }, status: "WAITING" },
      });
      if (movers.length !== movingRegistrationIds.length) {
        throw new Error("One or more selected players aren't currently waiting.");
      }

      // Whole-party, always — never a partial slice. The caller
      // (rotation-board.tsx) always passes a complete unit already; this
      // is defense against a stale/tampered request, not the normal
      // path — same "parties never split" rule as everywhere else in
      // this file (see createManualAssignment, assembleFoursome).
      const partyIds = new Set(
        movers.map((m) => m.partyId).filter((id): id is string => id !== null),
      );
      if (partyIds.size > 1) {
        throw new Error("Selected players span more than one party.");
      }
      if (partyIds.size === 1) {
        const [partyId] = [...partyIds];
        const fullParty = await tx.queueEntry.findMany({
          where: { date, partyId, status: "WAITING" },
        });
        if (fullParty.length !== movers.length) {
          throw new Error("A party moves together — select the whole party, not part of it.");
        }
      }

      // All party members already share one joinedQueueAt by construction
      // (fetchWaitingUnits's own comment) — preserved here, not
      // reinvented: every mover (party or solo) gets the SAME new value,
      // one millisecond after the target, so the group stays exactly as
      // "simultaneous" as it always is, and sorts immediately after the
      // target with no gap for an unrelated entry to land in between.
      const newJoinedQueueAt = new Date(target.joinedQueueAt.getTime() + 1);
      await tx.queueEntry.updateMany({
        where: { id: { in: movers.map((m) => m.id) } },
        data: { joinedQueueAt: newJoinedQueueAt },
      });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "queue_entry.moved_after",
      entityType: "QueueEntry",
      entityId: targetRegistrationId,
      newValues: { movingRegistrationIds, targetRegistrationId },
    });
  }

  // "build the group swap same as tv display" — the Next up preview box
  // (rotation-board.tsx) shows flattened members with no visible party
  // boundary, same as the TV display it mirrors, so swapping is framed as
  // "trade these two players' groups," not "edit this party's roster."
  // A plain exchange of partyId between the two entries: whatever group A
  // was in, B joins it and A leaves it (and vice versa) — size-preserving
  // by construction, so there's no capacity re-check to do. Both the
  // QueueEntry (what fetchWaitingUnits actually groups by) and the
  // OpenPlayNightRegistration (what re-check-in / other reads see) are
  // updated together so the two never drift apart.
  async swapPartyMember(
    date: Date,
    memberARegistrationId: string,
    memberBRegistrationId: string,
    actorUserId: string,
  ): Promise<void> {
    if (memberARegistrationId === memberBRegistrationId) {
      throw new Error("Pick two different players to swap.");
    }

    await prisma.$transaction(async (tx) => {
      const [entryA, entryB] = await Promise.all([
        tx.queueEntry.findFirst({
          where: { date, registrationId: memberARegistrationId, status: "WAITING" },
        }),
        tx.queueEntry.findFirst({
          where: { date, registrationId: memberBRegistrationId, status: "WAITING" },
        }),
      ]);
      if (!entryA || !entryB) {
        throw new Error("Both players must currently be waiting.");
      }
      if (entryA.partyId === entryB.partyId) {
        throw new Error("Those two players are already in the same group.");
      }

      await tx.queueEntry.update({ where: { id: entryA.id }, data: { partyId: entryB.partyId } });
      await tx.queueEntry.update({ where: { id: entryB.id }, data: { partyId: entryA.partyId } });
      await tx.openPlayNightRegistration.update({
        where: { id: memberARegistrationId },
        data: { partyId: entryB.partyId },
      });
      await tx.openPlayNightRegistration.update({
        where: { id: memberBRegistrationId },
        data: { partyId: entryA.partyId },
      });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "queue_entry.party_swapped",
      entityType: "QueueEntry",
      entityId: memberARegistrationId,
      newValues: { memberARegistrationId, memberBRegistrationId },
    });
  }

  // BUILD-SPEC.md §7 "done (left for the night). done frees a Fri/Sat
  // capacity slot and triggers waitlist promotion, reusing the existing
  // openPlayRegistrationService release/promotion logic" — that's exactly
  // markCheckedOut's job (Phase 5), so this delegates rather than
  // reimplementing release+promotion here.
  async markDone(queueEntryId: string, actorUserId: string): Promise<QueueEntry> {
    const entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: queueEntryId } });
    if (entry.status !== "WAITING" && entry.status !== "RESTING") {
      throw new Error(
        `Can only mark done a player who isn't mid-game (current status: ${entry.status.toLowerCase()}).`,
      );
    }
    const updated = await prisma.queueEntry.update({
      where: { id: queueEntryId },
      data: { status: "DONE" },
    });
    await openPlayRegistrationService.markCheckedOut(entry.registrationId, actorUserId);
    return updated;
  }

  // BUILD-SPEC.md §7 "Staff view — Live queue in order, wait times counting
  // up... Per court: who's on, elapsed time, next proposed foursome."
  async getRotationBoardData(date: Date): Promise<RotationBoardData> {
    const [courts, assignments, units, restingEntries, settings] = await Promise.all([
      prisma.court.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
      prisma.gameAssignment.findMany({
        where: { date, status: { in: ["ACTIVE", "PROPOSED"] } },
        include: { participants: { include: { registration: true } } },
      }),
      fetchWaitingUnits(date),
      prisma.queueEntry.findMany({
        where: { date, status: "RESTING" },
        orderBy: { playerName: "asc" },
      }),
      settingsService.getOpenPlaySettings(),
    ]);

    const now = Date.now();
    const boardCourts: RotationBoardCourt[] = courts.map((court) => ({
      court,
      active: assignments.find((a) => a.courtId === court.id && a.status === "ACTIVE") ?? null,
      proposed: assignments.find((a) => a.courtId === court.id && a.status === "PROPOSED") ?? null,
    }));

    const waiting: RotationBoardUnit[] = units
      .sort((a, b) => a.effectiveWaitStart.getTime() - b.effectiveWaitStart.getTime())
      .map((unit) => {
        const waitMinutes = Math.floor((now - unit.effectiveWaitStart.getTime()) / 60_000);
        return {
          partyId: unit.partyId,
          members: unit.members,
          waitMinutes,
          pastMaxWait: waitMinutes >= settings.maxWaitMinutes,
        };
      });

    const resting: RotationBoardRestingPlayer[] = restingEntries.map((entry) => ({
      queueEntryId: entry.id,
      registrationId: entry.registrationId,
      playerName: entry.playerName,
      skillLevel: entry.skillLevel,
    }));

    const hasIdleCourt = boardCourts.some((c) => !c.active && !c.proposed);
    const totalWaiting = units.reduce((sum, unit) => sum + unit.members.length, 0);
    let unfillableQueueReason: string | null = null;
    if (hasIdleCourt && totalWaiting >= 4) {
      const assembled = await assembleFoursome(units, settings, date);
      if (!assembled) {
        const partyCount = units.filter((u) => u.partyId !== null).length;
        unfillableQueueReason =
          partyCount > 0
            ? `${totalWaiting} players waiting, but they don't combine into a group of exactly 4 — parties are never split. Use manual override, or ask a party to split.`
            : `${totalWaiting} players waiting, but no group of exactly 4 could be assembled.`;
      }
    }

    return {
      courts: boardCourts,
      waiting,
      resting,
      maxWaitMinutes: settings.maxWaitMinutes,
      forgottenAssignmentNudgeMinutes: settings.forgottenAssignmentNudgeMinutes,
      unfillableQueueReason,
    };
  }

  private async createAssignment(
    input: {
      date: Date;
      courtId: string;
      sessionId: string | null;
      skillSpread: number;
      source: "AUTO" | "MANUAL";
      createdByUserId: string | null;
      registrationIds: string[];
    },
    actorUserId: string | null,
  ): Promise<GameAssignmentWithParticipants> {
    const result = await prisma.$transaction((tx) =>
      this.createAssignmentTx(tx, input, actorUserId),
    );

    await this.writeAuditLog({
      actorUserId,
      action: "game_assignment.proposed",
      entityType: "GameAssignment",
      entityId: result.id,
      newValues: {
        source: input.source,
        courtId: input.courtId,
        registrationIds: input.registrationIds,
      },
    });

    return result;
  }

  private async createAssignmentTx(
    tx: Prisma.TransactionClient,
    input: {
      date: Date;
      courtId: string;
      sessionId: string | null;
      skillSpread: number;
      source: "AUTO" | "MANUAL";
      createdByUserId: string | null;
      registrationIds: string[];
    },
    actorUserId: string | null,
  ): Promise<GameAssignmentWithParticipants> {
    const assignment = await tx.gameAssignment.create({
      data: {
        courtId: input.courtId,
        sessionId: input.sessionId,
        date: input.date,
        skillSpread: input.skillSpread,
        source: input.source,
        createdByUserId: input.createdByUserId,
        status: "PROPOSED",
        participants: {
          create: input.registrationIds.map((registrationId) => ({ registrationId })),
        },
      },
      include: { participants: { include: { registration: true } } },
    });

    // Marked PLAYING at proposal time, not just at confirm — this is what
    // makes "pin a foursome so auto-pairing skips those players until
    // their game runs" (§7) true: getWaitingUnits only ever sees WAITING
    // entries, so a proposed-but-unconfirmed foursome is already
    // unavailable to a different court's proposal.
    //
    // LOCK-ORDER WARNING (BUILD-SPEC.md §15): this update MUST stay in
    // the same transaction as the GameAssignment INSERT above. §15's
    // lock-order exception for proposeNextAssignment's QueueEntry-then-
    // GameAssignment order depends on this atomicity — a WAITING row can
    // never overlap with a row an active assignment is touching only
    // because this flip and that INSERT commit together. Splitting them
    // across transactions reopens a real deadlock risk between this
    // method and completeAssignment/cancelAssignmentTx's opposite order.
    await tx.queueEntry.updateMany({
      where: { registrationId: { in: input.registrationIds } },
      data: { status: "PLAYING" },
    });

    void actorUserId; // logged by the caller, not here — see createAssignment/createManualAssignment
    return assignment;
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

export const openPlayRotationService = new OpenPlayRotationService();
