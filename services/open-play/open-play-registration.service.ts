import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type {
  OpenPlayCredit,
  OpenPlayNightRegistration,
  OpenPlayNightRegistrationSource,
  OpenPlayRefund,
  OpenPlayWaitlistEntry,
  Prisma,
} from "@/lib/generated/prisma/client";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";
import { canTransitionOpenPlayWaitlistEntryStatus } from "@/services/open-play/open-play-waitlist-status";
import { playerService } from "@/services/player/player.service";
import { saleService } from "@/services/sales/sale.service";
import { settingsService } from "@/services/settings/settings.service";
import { getSmsService } from "@/services/sms/sms-service.factory";
import { OPEN_PLAY_SKILL_LEVEL_ORDER } from "@/types/open-play-skill-levels";
import { SYSTEM_ROLES } from "@/types/roles";

// BUILD-SPEC.md §5. Concurrency: SELECT ... FOR UPDATE on the session
// row (the spec's first-named technique, not the Serializable-isolation-
// plus-retry pattern booking.service.ts uses for the equivalent
// double-booking problem) — every concurrent registration or release
// against the same session serializes through the row lock and blocks in
// order rather than racing to commit and retrying on conflict. Simpler to
// reason about under real contention: no retry storm, no P2034 handling
// needed, transactions just queue.

interface AuditLogEntry {
  // null = system-driven (e.g. no-show auto-release), no human actor —
  // same precedent as membershipService.reconcileExpiredMemberships'
  // changedById: null, not a resolved "system user" identity.
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

export interface RegisterWalkInInput {
  playerName: string;
  phone: string;
  skillLevel: OpenPlaySkillLevel;
  playerId?: string;
  partyId?: string;
}

// Gate 2 review follow-up (BUILD-SPEC.md §9): the Fri/Sat ₱150 walk-in
// registration fee is real cash collected at the desk (registerWalkIn
// has marked CONFIRMED immediately since Phase 4/7), but had no Sale
// row and no payment-method attribution at all — sales reporting
// hardcoded this bucket to ₱0. Same shape as player-tab.service.ts's
// own SaleContext, duplicated rather than imported (this codebase's
// established per-service *SaleContext convention — see
// CreateBookingSaleContext, SellProductSaleContext, etc.), plus
// method/gcashReference alongside it, mirroring settleTab's own
// separate (method, gcashReference, saleContext) parameters exactly.
export interface RegisterWalkInSaleContext {
  method: "CASH" | "GCASH";
  gcashReference: string | null;
  paymentMethodId: string;
  employeeId: string;
  shiftId: string;
}

// Open-play online self-registration, Gate 2 (BUILD-SPEC.md §6). No
// playerId/partyId — the public path doesn't resolve a returning-player
// match or support party registration yet (neither was asked for; this
// mirrors exactly what §6's spec describes, nothing more).
export interface RegisterOnlineInput {
  playerName: string;
  phone: string;
  skillLevel: OpenPlaySkillLevel;
}

export type SubmitOnlineRegistrationResult =
  | { kind: "registered"; registration: OpenPlayNightRegistration }
  | { kind: "waitlisted"; entry: OpenPlayWaitlistEntry };

export type ReleaseStatus = "CANCELLED" | "NO_SHOW" | "CHECKED_OUT" | "REJECTED";

// Matches Phase 8's HOLD_DURATION_MINUTES (booking.service.ts) exactly,
// per this gate's explicit instruction to reuse holdExpiresAt's pattern,
// not invent a second one.
const HOLD_DURATION_MINUTES = 30;

// Cancellation policy Gate 1 (BUILD-SPEC.md's open-play "Cancellation
// policy" section). Both are the spec's own explicit proposed defaults —
// implemented as the actual behavior rather than left further open,
// since a concrete policy needs a concrete number and the spec already
// named one for each: "at least 4 hours before the session's start
// time" (the cutoff), and "90 days from issue" (credit expiry, under
// "Credit expiry — does it lapse?").
const CANCELLATION_CREDIT_CUTOFF_HOURS = 4;
const OPEN_PLAY_CREDIT_EXPIRY_DAYS = 90;

// Shared by registerWalkIn (a seat taken by cash-paid-immediately staff
// registration) and submitOnlineRegistration/inviteNextWaitlistEntry (a
// seat taken or provisionally held by an online registration) — ONE
// definition of "how many seats does this session currently have
// spoken for," used by every path that needs to answer that question,
// rather than each computing its own narrower view and disagreeing.
// waitlistPos is a walk-in-only concept (BUILD-SPEC.md §5 "Confirmed
// but no seat") — always null on every online-sourced row regardless of
// state, so filtering on it here only ever excludes walk-in rows still
// on the walk-in waitlist, exactly as before this predicate was shared.
// PENDING_VERIFICATION counts (proof submitted, not yet resolved —
// mirrors Booking's own "not excluded until REJECTED" stance). An
// AWAITING_PAYMENT hold only counts while its holdExpiresAt hasn't
// passed — mirrors booking.service.ts's checkAvailabilityWithClient's
// identical lazy-exclusion of an expired hold.
async function countOccupiedSeats(
  tx: Prisma.TransactionClient,
  sessionId: string,
  now: Date,
): Promise<number> {
  return tx.openPlayNightRegistration.count({
    where: {
      sessionId,
      waitlistPos: null,
      OR: [
        { status: "CONFIRMED" },
        { status: "PENDING_VERIFICATION" },
        { status: "AWAITING_PAYMENT", holdExpiresAt: { gte: now } },
      ],
    },
  });
}

export interface SessionRegistrations {
  registrations: OpenPlayNightRegistration[];
  skillBreakdown: Record<OpenPlaySkillLevel, number>;
}

async function lockSessionRow(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<{ id: string; date: Date; capacity: number } | null> {
  const rows = await tx.$queryRaw<{ id: string; date: Date; capacity: number }[]>`
    SELECT id, date, capacity FROM "OpenPlayNightSession" WHERE id = ${sessionId} FOR UPDATE
  `;
  return rows[0] ?? null;
}

// Gate 2 review follow-up: ONE mechanism for creating the Fri/Sat
// registration fee's Sale, shared (not duplicated) between
// registerWalkIn below and, in the future, whatever action lets staff
// confirm a waitlisted online registrant's CASH payment on arrival
// (§6's invite-to-pay flow — not built yet, but when it is, it must
// call this exact function, not grow a second, diverging one).
// Deliberately outside the class — same "duplicate a helper, don't
// couple two classes" precedent this file already follows for
// countOccupiedSeats/lockSessionRow, and callable from either without
// needing `this`. amountCents is read fresh from settings on every
// call, never cached, so an owner rate change applies to the very next
// registration — same reasoning as every other settings-backed
// business rule in this app.
export async function createOpenPlayRegistrationFeeSale(
  tx: Prisma.TransactionClient,
  registration: { id: string; playerId: string | null; playerName: string },
  saleContext: RegisterWalkInSaleContext,
): Promise<void> {
  const { friSatRegistrationFeeCents } = await settingsService.getOpenPlaySettings();
  if (friSatRegistrationFeeCents <= 0) {
    return;
  }
  await saleService.createSale(
    {
      category: "OPEN_PLAY",
      amountCents: friSatRegistrationFeeCents,
      paymentMethodId: saleContext.paymentMethodId,
      employeeId: saleContext.employeeId,
      shiftId: saleContext.shiftId,
      playerId: registration.playerId ?? undefined,
      openPlayNightRegistrationId: registration.id,
      description: `Fri/Sat open play registration — ${registration.playerName}`,
    },
    tx,
  );
}

// Gate 2 review follow-up: a walk-in for a MATCHED existing player (not
// a brand-new guest — `playerId` is only ever set once the search
// combobox resolves one) syncs the phone/skill level staff just typed
// back onto that Player's saved profile, via the same
// playerService.updatePlayer the Players admin screen already uses —
// not duplicated here. Overwrites rather than fill-only-if-empty: staff
// are re-entering this in front of the player right now, so a changed
// value is far more likely a real correction (new number, improved
// rating) than noise — the same "an edit invalidates the prior value"
// stance the search combobox itself already takes on a manual text
// edit. Best-effort: registration creation has already committed by
// the time this runs, so a sync failure (e.g. no email on file —
// User.email is nullable, but updatePlayer's shared profile schema
// still requires one) is logged and swallowed, never allowed to
// surface as a failure of the walk-in itself.
async function syncPlayerProfileFromWalkIn(
  playerId: string,
  playerName: string,
  phone: string,
  skillLevel: OpenPlaySkillLevel,
  actorUserId: string,
): Promise<void> {
  try {
    const player = await playerService.getPlayerById(playerId);
    if (!player || !player.user.email) {
      return;
    }
    await playerService.updatePlayer(
      playerId,
      {
        name: player.user.name ?? playerName,
        email: player.user.email,
        phone,
        bio: player.bio ?? undefined,
        dateOfBirth: player.dateOfBirth ?? undefined,
        skillLevel: player.skillLevel ?? undefined,
        openPlaySkillLevel: skillLevel,
        dominantHand: player.dominantHand ?? undefined,
        position: player.position ?? undefined,
      },
      actorUserId,
    );
  } catch (error) {
    logger.warn(
      { err: error, playerId },
      "Failed to sync player profile from walk-in registration",
    );
  }
}

export class OpenPlayRegistrationService {
  // Gate 2 review follow-up: an unmatched walk-in (no playerId — nobody
  // picked a search-combobox match) used to become a permanent guest —
  // playerName/phone stored as plain text, playerId left null forever,
  // no Player row ever created. The form promises "find a returning
  // player" but nobody could ever become one through this path.
  //
  // Phone number, not name, is the identity signal. Compares the LAST
  // 10 DIGITS, not the whole normalized string — found live, proven-
  // failing-first against this exact method: cancelRegistrationAsCustomer/
  // findConfirmedRegistrationForCancellation's own "strip non-digits,
  // exact match" shape (the starting point here) does NOT resolve
  // "0962 857 2974" and "+63 962 857 2974" as the same number — 11
  // digits starting with a trunk 0 vs. 12 digits starting with the
  // country code 63 never compare equal as full strings. That
  // distinction is fine for THAT flow (a customer typing their own
  // number back, likely the same way both times) but wrong for THIS
  // one — a 0-vs-+63 prefix swap is exactly the kind of "typed
  // differently" a real PH mobile number sees across two separate
  // walk-ins, and this app is Asia/Manila-only, never a second country's
  // numbers to accidentally conflate. Last-10-digits is exact and
  // unambiguous for a PH mobile number specifically (always 10 digits
  // after the trunk 0 or +63), not a fuzzy heuristic.
  //
  // Deliberately NOT fuzzy name-matching: a phone match is a far more
  // reliable identity signal, and name-similarity heuristics risk the
  // worse failure of silently merging two different people who happen
  // to share a common name. Search staying accurate (the
  // PlayerSearchCombobox word-match fix) is what carries "find them by
  // name later," not a fuzzy match here.
  //
  // A brand-new player created here gets no email and no passwordHash
  // — playerService.createPlayer's shared profile schema requires a
  // valid email (Players double as portal-login Users), but this
  // venue's walk-in form never collects one, and a desk walk-in has no
  // reason to want a portal login. Same MEMBER role, same audit trail,
  // just skipping a requirement that doesn't apply to this path.
  //
  // Deliberately called BEFORE registerWalkIn's session-locking
  // transaction opens, not inside it — found live, proven-failing-first
  // against open-play-registration.concurrency.integration.ts (10
  // concurrent registerWalkIn calls, capacity 5): with this method's
  // findMany scan plus user/player creates running while serialized
  // behind lockSessionRow's row lock, the queued-up later calls blew
  // Prisma's 5s interactive-transaction timeout (observed 5016ms,
  // P2028). Player lookup/creation has nothing to do with the session's
  // capacity, so it doesn't belong behind that lock — a lock should be
  // held as briefly as possible under real concurrent load. Accepts
  // `prisma` itself (not a `tx`) for exactly this reason at both call
  // sites now; typed as Prisma.TransactionClient because PrismaClient
  // structurally satisfies it, so this same method still works
  // unchanged for a caller that DOES want it inside an existing
  // transaction.
  //
  // Trade-off accepted: if the session-locking transaction that follows
  // throws (e.g. "session not found" — essentially never in practice),
  // a newly-created player here is not rolled back with it. That's a
  // harmless leftover (one extra, still-correct, still-findable Player
  // row with no registration attached), not a broken state — a
  // meaningfully better trade than serializing real desk traffic behind
  // a long-held lock. Separately, and out of scope for this pass: two
  // walk-ins registering the SAME brand-new phone number at the exact
  // same instant could each independently fail to find the other's
  // not-yet-committed row and both create a player — Player.phone has
  // no unique constraint, so nothing here prevents it. Not exercised by
  // the concurrency test (every concurrent call uses a distinct phone
  // number) and low-probability for a staffed front desk; a real fix
  // would need either a DB-level uniqueness decision (phone is
  // legitimately shared across some players — family members, spouses)
  // or an application-level lock keyed on phone, neither of which this
  // task asked for.
  private async findOrCreatePlayerForWalkIn(
    tx: Prisma.TransactionClient,
    input: { playerName: string; phone: string; skillLevel: OpenPlaySkillLevel },
    actorUserId: string,
  ): Promise<{ playerId: string; isNewPlayer: boolean }> {
    const last10Digits = (value: string) => value.replace(/\D/g, "").slice(-10);
    const normalizedPhone = last10Digits(input.phone);

    if (normalizedPhone.length === 10) {
      const candidates = await tx.player.findMany({
        where: { deletedAt: null, phone: { not: null } },
        select: { id: true, phone: true },
      });
      const existing = candidates.find(
        (candidate) => candidate.phone && last10Digits(candidate.phone) === normalizedPhone,
      );
      if (existing) {
        return { playerId: existing.id, isNewPlayer: false };
      }
    }

    const memberRole = await tx.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.MEMBER } });
    const user = await tx.user.create({
      data: { name: input.playerName, email: null, roleId: memberRole.id },
    });
    const player = await tx.player.create({
      data: { userId: user.id, phone: input.phone, openPlaySkillLevel: input.skillLevel },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "player.created_from_open_play_walk_in",
      entityType: "Player",
      entityId: player.id,
      newValues: { name: input.playerName, phone: input.phone },
    });

    return { playerId: player.id, isNewPlayer: true };
  }

  // Phase 4 only builds the staff walk-in path (cash, paid immediately —
  // see the OpenPlayNightRegistrationStatus enum comment in schema.prisma)
  // — status always lands on CONFIRMED; waitlistPos non-null means "paid,
  // no seat yet" rather than a separate status value.
  // saleContext is optional so pre-existing fixture/test call sites that
  // don't care about billing (rotation, concurrency, capacity tests
  // predating this fee ever being tracked) are byte-for-byte unaffected
  // — when omitted, no Sale is created regardless of the fee setting.
  // Every REAL call site (registerWalkInAction, registerAndCheckIn's
  // Fri/Sat branch) always supplies one; this is not a gap staff can
  // hit, only a deliberate opt-out for code that isn't testing money.
  async registerWalkIn(
    sessionId: string,
    input: RegisterWalkInInput,
    actorUserId: string,
    saleContext?: RegisterWalkInSaleContext,
  ): Promise<OpenPlayNightRegistration> {
    if (saleContext?.method === "GCASH" && !saleContext.gcashReference?.trim()) {
      throw new Error("A GCash reference number is required.");
    }

    // Resolved before the session lock below opens, deliberately — see
    // findOrCreatePlayerForWalkIn's own comment for why this must not
    // run inside lockSessionRow's serialized section.
    let resolvedPlayerId: string;
    let isNewPlayer = false;
    if (input.playerId) {
      resolvedPlayerId = input.playerId;
    } else {
      const result = await this.findOrCreatePlayerForWalkIn(prisma, input, actorUserId);
      resolvedPlayerId = result.playerId;
      isNewPlayer = result.isNewPlayer;
    }

    const registration = await prisma.$transaction(async (tx) => {
      const session = await lockSessionRow(tx, sessionId);
      if (!session) {
        throw new Error("Open play night session not found.");
      }

      // Open-play online self-registration, Gate 2: widened from a
      // CONFIRMED-only count to countOccupiedSeats (also sees an
      // unexpired online AWAITING_PAYMENT hold or PENDING_VERIFICATION
      // registration as occupying a seat) — a walk-in arriving mid-way
      // through someone's online pay-now window must not be seated on
      // top of it. Identical result to the old query whenever no online
      // registration exists for this session (the two new OR branches
      // simply match zero rows), which is always true while the
      // feature-wide switch is off — proven in this gate's hard-
      // boundary check, not just asserted.
      const seatedCount = await countOccupiedSeats(tx, sessionId, new Date());

      let waitlistPos: number | null = null;
      if (seatedCount >= session.capacity) {
        const { _max } = await tx.openPlayNightRegistration.aggregate({
          where: { sessionId, waitlistPos: { not: null } },
          _max: { waitlistPos: true },
        });
        waitlistPos = (_max.waitlistPos ?? 0) + 1;
      }

      const created = await tx.openPlayNightRegistration.create({
        data: {
          sessionId,
          date: session.date,
          playerId: resolvedPlayerId,
          playerName: input.playerName,
          phone: input.phone,
          skillLevel: input.skillLevel,
          partyId: input.partyId,
          source: "WALK_IN" satisfies OpenPlayNightRegistrationSource,
          status: "CONFIRMED",
          waitlistPos,
        },
      });

      // Owner decision (Fri/Sat waitlist rework): a desk walk-in on a
      // full night is added to the waiting roster at ZERO charge, not
      // charged the ₱150 up front — only a walk-in that takes a real
      // seat (waitlistPos null) owes the fee at registration time. A
      // waitlisted walk-in pays later, at the moment staff promote them
      // into a freed seat (see markNoShow/the manual release path).
      if (saleContext && created.waitlistPos === null) {
        await createOpenPlayRegistrationFeeSale(
          tx,
          { id: created.id, playerId: created.playerId, playerName: created.playerName },
          saleContext,
        );
      }

      return created;
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_registration.created",
      entityType: "OpenPlayNightRegistration",
      entityId: registration.id,
      newValues: {
        sessionId,
        waitlistPos: registration.waitlistPos,
        skillLevel: registration.skillLevel,
        ...(saleContext
          ? { paymentMethod: saleContext.method, paymentMethodId: saleContext.paymentMethodId }
          : {}),
      },
    });

    // Sync onto an EXISTING player — whether matched originally via the
    // search combobox, or just resolved via phone lookup above — never
    // for a player this same call just created, which already has
    // exactly this data and nothing to correct.
    if (!isNewPlayer) {
      await syncPlayerProfileFromWalkIn(
        resolvedPlayerId,
        input.playerName,
        input.phone,
        input.skillLevel,
        actorUserId,
      );
    }

    return registration;
  }

  // BUILD-SPEC.md §0 — weeknight open play has no capacity, no waitlist,
  // no prepayment, so no lock, no capacity check, no waitlistPos, ever.
  // `date` is the sole grouping key (no session to hang off of).
  async registerWeeknightWalkIn(
    date: Date,
    input: RegisterWalkInInput,
    actorUserId: string,
  ): Promise<OpenPlayNightRegistration> {
    // Same resolution as registerWalkIn's Fri/Sat path, and same reason
    // it runs standalone rather than inside a transaction with the
    // registration insert below — see findOrCreatePlayerForWalkIn's own
    // comment. This path has no session lock to worry about, but a
    // plain sequential await here is simpler than a transaction wrapper
    // that no longer buys atomicity worth paying for (a leftover
    // unlinked player on the rare failure of the insert below is
    // harmless — see that same comment).
    let resolvedPlayerId: string;
    let isNewPlayer = false;
    if (input.playerId) {
      resolvedPlayerId = input.playerId;
    } else {
      const result = await this.findOrCreatePlayerForWalkIn(prisma, input, actorUserId);
      resolvedPlayerId = result.playerId;
      isNewPlayer = result.isNewPlayer;
    }

    const registration = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: null,
        date,
        playerId: resolvedPlayerId,
        playerName: input.playerName,
        phone: input.phone,
        skillLevel: input.skillLevel,
        partyId: input.partyId,
        source: "WALK_IN" satisfies OpenPlayNightRegistrationSource,
        status: "CONFIRMED",
        waitlistPos: null,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_registration.created",
      entityType: "OpenPlayNightRegistration",
      entityId: registration.id,
      newValues: { date, skillLevel: registration.skillLevel },
    });

    if (!isNewPlayer) {
      await syncPlayerProfileFromWalkIn(
        resolvedPlayerId,
        input.playerName,
        input.phone,
        input.skillLevel,
        actorUserId,
      );
    }

    return registration;
  }

  // Open-play online self-registration, Gate 2 (BUILD-SPEC.md §6). The
  // raw registration-or-waitlist decision, source=WEBSITE hardcoded
  // here (never accepted from a caller-supplied field — there isn't
  // one on RegisterOnlineInput to begin with) — no switch check inside
  // this method, same split as booking.service.ts's createBookingHold:
  // the feature-wide/per-day gate checks live in the thin public
  // wrapper (services/open-play/public-open-play-registration.service.ts),
  // this method assumes the caller already decided registration is
  // allowed right now. actorUserId is always null — no real staff user
  // triggers this, same precedent this file's own reconcileNoShows
  // caller already established (markNoShow's system release), not
  // Booking's separate borrowed-website-identity pattern.
  //
  // Same lock as registerWalkIn (`lockSessionRow`, §15 pattern 1) — two
  // people submitting for the same session's last seat concurrently
  // serialize through it exactly like a walk-in racing another walk-in
  // does today; no new concurrency pattern introduced.
  async submitOnlineRegistration(
    sessionId: string,
    input: RegisterOnlineInput,
  ): Promise<SubmitOnlineRegistrationResult> {
    const result = await prisma.$transaction(async (tx) => {
      const session = await lockSessionRow(tx, sessionId);
      if (!session) {
        throw new Error("Open play night session not found.");
      }

      const now = new Date();
      const occupied = await countOccupiedSeats(tx, sessionId, now);

      if (occupied < session.capacity) {
        const holdExpiresAt = new Date(now.getTime() + HOLD_DURATION_MINUTES * 60_000);
        const registration = await tx.openPlayNightRegistration.create({
          data: {
            sessionId,
            date: session.date,
            playerName: input.playerName,
            phone: input.phone,
            skillLevel: input.skillLevel,
            source: "WEBSITE" satisfies OpenPlayNightRegistrationSource,
            status: "AWAITING_PAYMENT",
            holdExpiresAt,
          },
        });
        return { kind: "registered" as const, registration };
      }

      // Full — BUILD-SPEC.md §6 "no payment prompt at all... no hold, no
      // proof row." No OpenPlayNightRegistration row at all, on purpose
      // (see OpenPlayWaitlistEntry's own schema comment) — just the
      // waitlist entry.
      const entry = await tx.openPlayWaitlistEntry.create({
        data: {
          sessionId,
          playerName: input.playerName,
          phone: input.phone,
          skillLevel: input.skillLevel,
        },
      });
      return { kind: "waitlisted" as const, entry };
    });

    if (result.kind === "registered") {
      await this.writeAuditLog({
        actorUserId: null,
        action: "open_play_night_registration.online_hold_created",
        entityType: "OpenPlayNightRegistration",
        entityId: result.registration.id,
        newValues: { sessionId, holdExpiresAt: result.registration.holdExpiresAt },
      });
    } else {
      await this.writeAuditLog({
        actorUserId: null,
        action: "open_play_waitlist_entry.created",
        entityType: "OpenPlayWaitlistEntry",
        entityId: result.entry.id,
        newValues: { sessionId },
      });
    }

    return result;
  }

  // Open-play online self-registration, Gate 2. "When a slot frees ...
  // the next waitlisted person is invited to pay" (BUILD-SPEC.md §6).
  // Called from inside an ALREADY-locked session transaction — either
  // releaseRegistration's own tx (a cancellation/no-show/check-out just
  // found no walk-in waitlist head to promote) or
  // OpenPlayCapacityService.setSessionCapacityOverride's tx (capacity
  // just increased) — never acquires its own lock, matching §15's
  // canonical order (Session first, always) rather than introducing a
  // second lock site for the same row.
  //
  // Lazy invite-expiry (mirrors Booking's own "lazy exclusion, no
  // active sweep" precedent exactly, per this gate's instruction to
  // reuse the pattern) — resolved right here, at the one moment it
  // actually matters (a slot is about to be offered), not on a
  // schedule. At most one INVITED entry per session at a time is the
  // invariant this method maintains: if one is still live (not past its
  // deadline), do nothing rather than double-invite; if it's expired,
  // transition it EXPIRED first, then fall through and try the next
  // WAITING entry in the same call — one "a slot is available" moment
  // can both resolve a stale invite and hand the slot to someone new.
  async inviteNextWaitlistEntry(
    tx: Prisma.TransactionClient,
    session: { id: string; date: Date },
    actorUserId: string | null,
  ): Promise<void> {
    const now = new Date();

    // Resolve every stale invite first — cleanliness/audit correctness,
    // not a capacity effect: countOccupiedSeats already stops counting
    // an AWAITING_PAYMENT hold the instant its own holdExpiresAt passes,
    // independent of whether this write has run yet (same lazy-exclusion
    // reasoning as Booking's own expired-hold handling). More than one
    // can be stale at once if this session went a while without anyone
    // freeing a slot to trigger this method — resolve all of them, not
    // just the first found.
    const staleInvites = await tx.openPlayWaitlistEntry.findMany({
      where: { sessionId: session.id, status: "INVITED", inviteExpiresAt: { lt: now } },
    });
    for (const stale of staleInvites) {
      if (!canTransitionOpenPlayWaitlistEntryStatus("INVITED", "EXPIRED")) {
        // Defensive — the state machine says this transition is invalid,
        // which would mean this method's own invariant (EXPIRED is only
        // ever reached from INVITED) has already been violated
        // elsewhere. Fail loudly rather than silently writing a status
        // the transition table doesn't allow.
        throw new Error(`Cannot transition waitlist entry ${stale.id} from INVITED to EXPIRED.`);
      }
      await tx.openPlayWaitlistEntry.update({
        where: { id: stale.id },
        data: { status: "EXPIRED" },
      });
      await this.writeAuditLog({
        actorUserId,
        action: "open_play_waitlist_entry.invite_expired",
        entityType: "OpenPlayWaitlistEntry",
        entityId: stale.id,
        newValues: { status: "EXPIRED" },
      });
    }

    // Seat-aware, not "at most one outstanding invite ever": BUILD-SPEC.md
    // §6 describes one freed slot inviting one person, and "capacity
    // raised" can free several slots at once (e.g. 30 -> 35), so this
    // invites as many WAITING entries, FCFS, as there is currently
    // room for — each invite's own new hold counts toward occupied for
    // the next iteration via countOccupiedSeats, so the loop naturally
    // stops the moment seats run out. Bounded by real row counts
    // (WAITING entries, session capacity), no artificial cap needed.
    for (;;) {
      const currentSession = await tx.openPlayNightSession.findUniqueOrThrow({
        where: { id: session.id },
        select: { capacity: true },
      });
      const occupied = await countOccupiedSeats(tx, session.id, now);
      if (occupied >= currentSession.capacity) {
        return;
      }

      const nextWaiting = await tx.openPlayWaitlistEntry.findFirst({
        where: { sessionId: session.id, status: "WAITING" },
        orderBy: { submittedAt: "asc" },
      });
      if (!nextWaiting) {
        return;
      }

      if (!canTransitionOpenPlayWaitlistEntryStatus("WAITING", "INVITED")) {
        throw new Error(
          `Cannot transition waitlist entry ${nextWaiting.id} from WAITING to INVITED.`,
        );
      }

      const holdExpiresAt = new Date(now.getTime() + HOLD_DURATION_MINUTES * 60_000);
      const registration = await tx.openPlayNightRegistration.create({
        data: {
          sessionId: session.id,
          date: session.date,
          playerName: nextWaiting.playerName,
          phone: nextWaiting.phone,
          skillLevel: nextWaiting.skillLevel,
          source: "WEBSITE" satisfies OpenPlayNightRegistrationSource,
          status: "AWAITING_PAYMENT",
          holdExpiresAt,
        },
      });

      await tx.openPlayWaitlistEntry.update({
        where: { id: nextWaiting.id },
        data: {
          status: "INVITED",
          invitedAt: now,
          inviteExpiresAt: holdExpiresAt,
          registrationId: registration.id,
        },
      });

      await this.writeAuditLog({
        actorUserId,
        action: "open_play_waitlist_entry.invited",
        entityType: "OpenPlayWaitlistEntry",
        entityId: nextWaiting.id,
        newValues: { registrationId: registration.id, inviteExpiresAt: holdExpiresAt },
      });

      // A waitlisted customer isn't watching the dashboard the way staff
      // are (BUILD-SPEC.md §6) — SMS is the only channel that actually
      // reaches them. Best-effort: a delivery failure here must not roll
      // back the invite/hold itself (the seat is still genuinely theirs
      // until holdExpiresAt), so this is deliberately outside the
      // transaction's failure path — logged, not thrown.
      try {
        await getSmsService().send(
          nextWaiting.phone,
          `The Courtroom: A spot has opened up for Open Play! You have until ${holdExpiresAt.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })} to confirm and pay, or your spot will be given to the next person.`,
        );
      } catch (error) {
        logger.error(
          { error, waitlistEntryId: nextWaiting.id },
          "Failed to send open-play waitlist invite SMS",
        );
      }
    }
  }

  // Gate 2 review follow-up: inviteNextWaitlistEntry only ever runs from
  // releaseRegistration or setSessionCapacityOverride — a lapsed invite
  // with neither a cancellation nor a capacity change to trigger it would
  // otherwise sit unresolved (the WaitlistEntry stuck at INVITED, the
  // next WAITING entry never invited) indefinitely. Same lazy-
  // reconciliation-on-read pattern as openPlayCheckinService's own
  // reconcileNoShows (this codebase's established no-cron precedent) —
  // called from the capacity/roster screen's own read path
  // (getCheckInScreenData), not on a schedule.
  //
  // Fairness gap found investigating QR-registration rollout risk: the
  // pre-check below used to only look for a stale INVITED row — which
  // does nothing for a first-time AWAITING_PAYMENT hold expiring, since
  // nobody has been through the invite cycle yet in that case, so no
  // INVITED row exists to find. countOccupiedSeats already stops
  // counting that expired hold (same lazy exclusion as everywhere else),
  // so the seat WAS free — it just went to whoever submitted next
  // instead of the earliest waitlisted person, exactly the "surge"
  // scenario a QR code makes likely. Broadened to: does ANYONE
  // (WAITING or INVITED) exist on this session's waitlist at all? If
  // so, take the lock and let inviteNextWaitlistEntry's own fresh
  // countOccupiedSeats check decide whether a seat is actually free
  // right now — that one call already correctly handles both a stale
  // re-invite AND a first-time hold expiry, the gate above it was the
  // only thing too narrow. Proven against real rows: services/open-play/
  // open-play-first-hold-expiry-invite.integration.ts.
  async reconcileExpiredInvites(sessionId: string, actorUserId: string | null): Promise<void> {
    const session = await prisma.openPlayNightSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      return;
    }

    const anyoneWaiting = await prisma.openPlayWaitlistEntry.findFirst({
      where: { sessionId, status: { in: ["WAITING", "INVITED"] } },
      select: { id: true },
    });
    if (!anyoneWaiting) {
      return;
    }

    await prisma.$transaction(async (tx) => {
      const locked = await lockSessionRow(tx, sessionId);
      if (!locked) {
        return;
      }
      await this.inviteNextWaitlistEntry(tx, { id: locked.id, date: locked.date }, actorUserId);
    });
  }

  // Reported live: no way anywhere to fix a typo'd name or phone number
  // on an existing registration short of cancelling and re-registering
  // (losing their place in the queue in the process). Deliberately just
  // these two fields — skillLevel/partyId aren't editable here, this is
  // a correction tool, not a re-registration form. No status/waitlistPos
  // check: a name typo is just as real on a CONFIRMED, checked-in, or
  // even a CANCELLED row, and restricting this to "only while waiting"
  // would be an arbitrary limit the actual reported need never asked for.
  async updateRegistrationDetails(
    registrationId: string,
    input: { playerName?: string; phone?: string },
    actorUserId: string,
  ): Promise<OpenPlayNightRegistration> {
    const existing = await prisma.openPlayNightRegistration.findUniqueOrThrow({
      where: { id: registrationId },
    });

    const updated = await prisma.openPlayNightRegistration.update({
      where: { id: registrationId },
      data: {
        playerName: input.playerName,
        phone: input.phone,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_registration.details_updated",
      entityType: "OpenPlayNightRegistration",
      entityId: registrationId,
      oldValues: { playerName: existing.playerName, phone: existing.phone },
      newValues: { playerName: updated.playerName, phone: updated.phone },
    });

    return updated;
  }

  // actorUserId is nullable — widened for cancelRegistrationAsCustomer
  // below, which passes null (same "no real staff user, unauthenticated
  // public path" convention already used by submitOnlineRegistration and
  // markNoShow's system release, not the booking-side "attribute to the
  // seeded Website identity" convention, which this file never adopted).
  // Every staff-initiated call site still passes a real user id.
  async cancelRegistration(
    registrationId: string,
    actorUserId: string | null,
  ): Promise<OpenPlayNightRegistration> {
    return this.releaseRegistration(registrationId, "CANCELLED", actorUserId);
  }

  // Cancellation policy Gate 1, customer-facing half: phone is the only
  // "auth" a public, unauthenticated customer has — same normalize-and-
  // compare shape as bookingService.findByReferenceAndPhone (strip non-
  // digits, exact match), duplicated rather than imported (this
  // codebase's established per-service small-helper precedent). Scoped
  // to source === "WEBSITE" deliberately: this is "a cancellation path
  // for an online registration" per the instruction that created it, not
  // a general walk-in-cancellation UI — a walk-in customer isn't using a
  // public self-service page for a same-night registration. Delegates to
  // cancelRegistration (actorUserId: null) so the SAME credit-or-forfeit
  // logic in releaseRegistration applies, not a second, diverging path.
  async cancelRegistrationAsCustomer(
    registrationId: string,
    phone: string,
  ): Promise<OpenPlayNightRegistration> {
    const normalize = (value: string) => value.replace(/\D/g, "");
    const providedPhone = normalize(phone);

    const registration = await prisma.openPlayNightRegistration.findUnique({
      where: { id: registrationId },
    });
    if (
      !registration ||
      registration.source !== "WEBSITE" ||
      !providedPhone ||
      normalize(registration.phone) !== providedPhone
    ) {
      throw new Error("We couldn't find a registration matching that phone number.");
    }

    return this.cancelRegistration(registrationId, null);
  }

  // The lookup half of the same flow — finds the ONE confirmed,
  // WEBSITE-sourced registration for a phone+night combination, so a
  // public "find my registration" page can show it before the customer
  // confirms cancellation. Same normalize-and-compare shape as above.
  async findConfirmedRegistrationForCancellation(
    phone: string,
    date: Date,
  ): Promise<OpenPlayNightRegistration | null> {
    const normalize = (value: string) => value.replace(/\D/g, "");
    const providedPhone = normalize(phone);
    if (!providedPhone) {
      return null;
    }

    const candidates = await prisma.openPlayNightRegistration.findMany({
      where: { date, status: "CONFIRMED", source: "WEBSITE" },
    });
    return candidates.find((candidate) => normalize(candidate.phone) === providedPhone) ?? null;
  }

  // actorUserId is nullable here specifically for reconcileNoShows'
  // system-driven auto-release (BUILD-SPEC.md §6 "No-shows") — every
  // staff-initiated call site still passes a real user id.
  async markNoShow(
    registrationId: string,
    actorUserId: string | null,
  ): Promise<OpenPlayNightRegistration> {
    return this.releaseRegistration(registrationId, "NO_SHOW", actorUserId);
  }

  async markCheckedOut(
    registrationId: string,
    actorUserId: string,
  ): Promise<OpenPlayNightRegistration> {
    return this.releaseRegistration(registrationId, "CHECKED_OUT", actorUserId);
  }

  // Reported live: test registrations made while trying out the public
  // form had no way to clean up except direct database access — every
  // existing action (cancel/no-show/refund) changes STATUS, none of them
  // actually remove the row. Deliberately narrow, not a general "delete
  // any registration" tool: blocked outright for CONFIRMED/CHECKED_OUT
  // (a real or once-real seat — use Cancel/No-show/Refund, which already
  // handle waitlist promotion and credit correctly) and for anything
  // with a linked Sale (a real, completed financial transaction — Sale
  // is this app's actual revenue ledger; deleting one would silently
  // remove real reporting history, test money or not). Everything this
  // DOES allow — AWAITING_PAYMENT/PENDING_VERIFICATION/NO_SHOW/
  // CANCELLED/REJECTED with no Sale — is, by construction, a row that
  // never became real, billable activity.
  async deleteRegistration(registrationId: string, actorUserId: string): Promise<void> {
    const registration = await prisma.openPlayNightRegistration.findUniqueOrThrow({
      where: { id: registrationId },
    });

    if (registration.status === "CONFIRMED" || registration.status === "CHECKED_OUT") {
      throw new Error(
        "Can't delete a confirmed or checked-out registration — use Cancel, No-show, or Refund instead.",
      );
    }

    const sale = await prisma.sale.findUnique({
      where: { openPlayNightRegistrationId: registrationId },
    });
    if (sale) {
      throw new Error(
        "This registration has a recorded sale and can't be deleted — refund it instead if needed.",
      );
    }

    const gameParticipation = await prisma.gameAssignmentParticipant.findFirst({
      where: { registrationId },
    });
    if (gameParticipation) {
      throw new Error("This registration was part of a game assignment and can't be deleted.");
    }

    await prisma.$transaction([
      prisma.openPlayRegistrationPaymentProof.deleteMany({ where: { registrationId } }),
      prisma.openPlayWaitlistEntry.deleteMany({ where: { registrationId } }),
      prisma.queueEntry.deleteMany({ where: { registrationId } }),
      prisma.openPlayNightRegistration.delete({ where: { id: registrationId } }),
    ]);

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_registration.deleted",
      entityType: "OpenPlayNightRegistration",
      entityId: registrationId,
      oldValues: registration,
    });
  }

  // Gate 3: called by openPlayRegistrationPaymentProofService after a
  // submitted GCash proof is rejected — terminal, same as CANCELLED
  // (mirrors Booking's own "REJECTED is terminal, same slot-freeing
  // shape as CANCELLED" reasoning). releaseRegistration's existing
  // releasableStatuses already includes PENDING_VERIFICATION (widened
  // in Gate 2), so this correctly frees the seat and runs the same
  // walk-in-waitlist-first-then-online-waitlist promotion/invite logic
  // every other release path already uses — no new mechanism.
  async rejectRegistration(
    registrationId: string,
    actorUserId: string,
  ): Promise<OpenPlayNightRegistration> {
    return this.releaseRegistration(registrationId, "REJECTED", actorUserId);
  }

  // BUILD-SPEC.md §5 "Auto-promotion... inside the same transaction as
  // the status change, so a freed slot is never lost or double-assigned."
  // Locks the session row too (not just the registration being released)
  // so a concurrent registerWalkIn can't read a stale seated count while
  // a release+promotion is in flight.
  private async releaseRegistration(
    registrationId: string,
    status: ReleaseStatus,
    actorUserId: string | null,
  ): Promise<OpenPlayNightRegistration> {
    const released = await prisma.$transaction(async (tx) => {
      const existing = await tx.openPlayNightRegistration.findUniqueOrThrow({
        where: { id: registrationId },
      });

      // Weeknight (sessionId null) has no capacity/waitlist at all — just
      // flip the status, nothing to lock or promote. Also never eligible
      // for a cancellation credit: weeknight has no registration fee, so
      // no Sale ever exists to base one on (see createOpenPlayRegistrationFeeSale,
      // Fri/Sat-only by construction) — issuedCredit is always null here.
      if (!existing.sessionId) {
        const updated = await tx.openPlayNightRegistration.update({
          where: { id: registrationId },
          data: {
            status,
            checkedOutAt: status === "CHECKED_OUT" ? new Date() : existing.checkedOutAt,
          },
        });
        return { updated, issuedCredit: null };
      }

      await lockSessionRow(tx, existing.sessionId);

      // Hardening phase fix (BUILD-SPEC.md §0 process rule): releasedHadSeat
      // / releasedWaitlistPos used to be computed from `existing`, read
      // BEFORE the session lock above. Two concurrent releases of the SAME
      // registration (a cancel button double-tapped, or a cancel racing an
      // auto no-show) both read the row as CONFIRMED before either had
      // acquired the lock — the lock only serializes their commits, it
      // doesn't retroactively invalidate what each had already decided to
      // do. Whichever one actually runs second still "frees a seat" from
      // data that's stale by the time it runs, and promotes a second
      // waitlist entry for a seat that was already given away once — one
      // real freed seat, two promotions. Re-reading the registration's own
      // row fresh, AFTER the session lock is held (so nothing else can
      // interleave), closes the gap: the second transaction sees the
      // first one's already-committed status and knows there's nothing
      // left to release.
      //
      // LOCK-ORDER NOTE (BUILD-SPEC.md §15 "canonical lock order"): this
      // is deliberately a PLAIN read, not FOR UPDATE. The session lock
      // above already serializes every concurrent releaseRegistration
      // call for this session, so there's nothing left for a second lock
      // to protect against — do not wrap this in FOR UPDATE. Doing so
      // would create a real OpenPlayNightSession-before-
      // OpenPlayNightRegistration lock order, violating §15's canonical
      // order (Registration ranks before Session), for zero behavioral
      // gain.
      const current = await tx.openPlayNightRegistration.findUniqueOrThrow({
        where: { id: registrationId },
      });
      // Open-play online self-registration, Gate 2: widened from
      // CONFIRMED-only. An online registration can be released while
      // AWAITING_PAYMENT (a hold nobody paid) or PENDING_VERIFICATION
      // (proof submitted, not yet resolved) — both genuinely occupy a
      // seat per countOccupiedSeats, so cancelling either one must free
      // it and run the same promotion/invite logic below, not silently
      // no-op the way this guard used to treat every non-CONFIRMED
      // status. CHECKED_OUT/CANCELLED/NO_SHOW/REJECTED are still
      // terminal — cancelling one of those (a concurrent or earlier
      // release already happened) stays the idempotent no-op it always
      // was.
      const releasableStatuses: (typeof current.status)[] = [
        "CONFIRMED",
        "AWAITING_PAYMENT",
        "PENDING_VERIFICATION",
      ];
      if (!releasableStatuses.includes(current.status)) {
        // Already released by a concurrent (or earlier) call — idempotent
        // no-op, same treatment as check-in's double-tap. No credit here
        // either: a genuine second release attempt does not issue a
        // second credit for the same cancellation.
        return { updated: current, issuedCredit: null };
      }

      const releasedHadSeat = current.waitlistPos === null;
      const releasedWaitlistPos = current.waitlistPos;

      const updated = await tx.openPlayNightRegistration.update({
        where: { id: registrationId },
        data: {
          status,
          checkedOutAt: status === "CHECKED_OUT" ? new Date() : current.checkedOutAt,
        },
      });

      // Cancellation policy Gate 1: the fee is non-refundable either way
      // (no cash ever moves here) — this only decides whether the
      // customer walks away with an OpenPlayCredit. Gated strictly on
      // status === "CANCELLED": a NO_SHOW forfeits by definition (BUILD-
      // SPEC's own reasoning — a no-show is definitionally past the
      // cutoff), REJECTED never had a real payment behind it (Sale is
      // only created on approval, never on submission), and CHECKED_OUT
      // is an end-of-night operational state, not a cancellation. Only
      // CONFIRMED (paid) registrations are eligible — current.status,
      // not existing.status, since current is the fresh re-read taken
      // after the session lock above (same staleness reasoning as
      // releasedHadSeat/releasedWaitlistPos, just below).
      const issuedCredit =
        status === "CANCELLED" && current.status === "CONFIRMED"
          ? await this.issueCancellationCreditIfEligible(tx, current)
          : null;

      if (releasedHadSeat) {
        const head = await tx.openPlayNightRegistration.findFirst({
          where: { sessionId: existing.sessionId, waitlistPos: { not: null } },
          orderBy: { waitlistPos: "asc" },
        });
        if (head) {
          await tx.openPlayNightRegistration.update({
            where: { id: head.id },
            data: { waitlistPos: null },
          });
          await tx.openPlayNightRegistration.updateMany({
            where: { sessionId: existing.sessionId, waitlistPos: { gt: head.waitlistPos ?? 0 } },
            data: { waitlistPos: { decrement: 1 } },
          });
        } else {
          // Open-play online self-registration, Gate 2: the paid walk-in
          // waitlist (waitlistPos-based, above) always gets first claim
          // on a freed seat — unchanged, still the very branch this
          // comment sits in. Only once THAT waitlist has nobody left
          // does the freed seat go to the online waitlist instead. Same
          // transaction, same session lock already held above — not a
          // second, parallel release mechanism.
          await this.inviteNextWaitlistEntry(
            tx,
            { id: existing.sessionId, date: existing.date },
            actorUserId,
          );
        }
      } else if (releasedWaitlistPos !== null) {
        // Released registration was itself waitlisted, not seated — no
        // promotion, just close the gap behind it.
        await tx.openPlayNightRegistration.updateMany({
          where: { sessionId: existing.sessionId, waitlistPos: { gt: releasedWaitlistPos } },
          data: { waitlistPos: { decrement: 1 } },
        });
      }

      return { updated, issuedCredit };
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_registration.released",
      entityType: "OpenPlayNightRegistration",
      entityId: released.updated.id,
      newValues: { status },
    });

    if (released.issuedCredit) {
      await this.writeAuditLog({
        actorUserId,
        action: "open_play_night_registration.cancellation_credit_issued",
        entityType: "OpenPlayCredit",
        entityId: released.issuedCredit.id,
        newValues: released.issuedCredit,
      });
    }

    return released.updated;
  }

  // Cancellation policy Gate 1 (BUILD-SPEC.md's open-play "Cancellation
  // policy" section). Called only from releaseRegistration's Fri/Sat
  // branch, only when status is being set to CANCELLED on a registration
  // that was CONFIRMED. The fee is non-refundable EITHER WAY — this
  // never touches the original Sale, only decides whether an
  // OpenPlayCredit is issued alongside the cancellation:
  //   - Before the cutoff (4 hours before session start): credit, so
  //     cancelling has an upside over a silent no-show (the whole reason
  //     the policy needs this half at all — see the model's own comment).
  //   - At or after the cutoff: no credit — by then a freed seat can't
  //     realistically be refilled, same practical outcome as a no-show.
  //   - No Sale exists for this registration at all (fee setting was 0
  //     at registration time, or — structurally impossible today, but
  //     checked anyway — a CONFIRMED registration that never got billed):
  //     nothing to credit.
  private async issueCancellationCreditIfEligible(
    tx: Prisma.TransactionClient,
    current: OpenPlayNightRegistration,
  ): Promise<OpenPlayCredit | null> {
    const sale = await tx.sale.findUnique({ where: { openPlayNightRegistrationId: current.id } });
    if (!sale) {
      return null;
    }

    const session = await tx.openPlayNightSession.findUniqueOrThrow({
      where: { id: current.sessionId! },
      select: { startAt: true },
    });
    const cutoff = new Date(
      session.startAt.getTime() - CANCELLATION_CREDIT_CUTOFF_HOURS * 60 * 60 * 1000,
    );
    if (new Date() >= cutoff) {
      return null;
    }

    const issuedAt = new Date();
    return tx.openPlayCredit.create({
      data: {
        phone: current.phone,
        amountCents: sale.amountCents,
        reason: `Cancelled registration ${current.id}`,
        sourceRegistrationId: current.id,
        issuedAt,
        expiresAt: new Date(
          issuedAt.getTime() + OPEN_PLAY_CREDIT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
        ),
      },
    });
  }

  // Staff-initiated refund path (BUILD-SPEC.md's "Staff-initiated
  // refunds must exist, separately" — item 2 of the cancellation policy
  // section). Distinct from the customer-facing non-refundable/credit
  // policy above: this is real cash back for the BUSINESS's own error
  // (a valid payment wrongly rejected, a genuine double payment, a
  // staff-cancelled night) — never reachable from customer cancellation,
  // which always goes through issueCancellationCreditIfEligible instead.
  // Same "no anonymous refunds" shape as PlayerTab's write-off and
  // BookingRefund: a real Employee and a required reason, both enforced
  // here (not just at the schema layer) since this method is the actual
  // money-moving boundary. Deliberately does NOT touch the registration's
  // own status — a refund is a fact about money, not a re-statement of
  // what already happened to the registration (which may already be
  // REJECTED, CANCELLED, or still CONFIRMED, depending on which of the
  // three error scenarios this is).
  async refundRegistration(
    registrationId: string,
    amountCents: number,
    reason: string,
    employeeId: string,
    actorUserId: string,
  ): Promise<OpenPlayRefund> {
    if (!reason.trim()) {
      throw new Error("A refund reason is required.");
    }
    if (amountCents <= 0) {
      throw new Error("Enter a valid refund amount.");
    }

    // Fails loudly (findUniqueOrThrow) rather than silently refunding a
    // registration that doesn't exist — same "trust nothing from the
    // caller past this point" posture as every other money-write here.
    await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: registrationId } });

    const refund = await prisma.openPlayRefund.create({
      data: { registrationId, amountCents, reason: reason.trim(), employeeId },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_registration.refunded",
      entityType: "OpenPlayRefund",
      entityId: refund.id,
      newValues: refund,
    });

    return refund;
  }

  async getSessionRegistrations(sessionId: string): Promise<SessionRegistrations> {
    const registrations = await prisma.openPlayNightRegistration.findMany({
      where: { sessionId },
      orderBy: [{ waitlistPos: "asc" }, { registeredAt: "asc" }],
    });

    const skillBreakdown = Object.fromEntries(
      OPEN_PLAY_SKILL_LEVEL_ORDER.map((level) => [level, 0]),
    ) as Record<OpenPlaySkillLevel, number>;
    for (const registration of registrations) {
      if (registration.status === "CONFIRMED") {
        skillBreakdown[registration.skillLevel] += 1;
      }
    }

    return { registrations, skillBreakdown };
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

export const openPlayRegistrationService = new OpenPlayRegistrationService();
