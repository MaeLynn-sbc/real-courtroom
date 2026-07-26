import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type {
  OpenPlayNightRegistration,
  OpenPlayNightRegistrationSource,
  OpenPlayWaitlistEntry,
  Prisma,
} from "@/lib/generated/prisma/client";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";
import { canTransitionOpenPlayWaitlistEntryStatus } from "@/services/open-play/open-play-waitlist-status";
import { saleService } from "@/services/sales/sale.service";
import { settingsService } from "@/services/settings/settings.service";
import { getSmsService } from "@/services/sms/sms-service.factory";
import { OPEN_PLAY_SKILL_LEVEL_ORDER } from "@/types/open-play-skill-levels";

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

export type ReleaseStatus = "CANCELLED" | "NO_SHOW" | "CHECKED_OUT";

// Matches Phase 8's HOLD_DURATION_MINUTES (booking.service.ts) exactly,
// per this gate's explicit instruction to reuse holdExpiresAt's pattern,
// not invent a second one.
const HOLD_DURATION_MINUTES = 30;

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
async function countOccupiedSeats(tx: Prisma.TransactionClient, sessionId: string, now: Date): Promise<number> {
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
async function createOpenPlayRegistrationFeeSale(
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

export class OpenPlayRegistrationService {
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
          playerId: input.playerId,
          playerName: input.playerName,
          phone: input.phone,
          skillLevel: input.skillLevel,
          partyId: input.partyId,
          source: "WALK_IN" satisfies OpenPlayNightRegistrationSource,
          status: "CONFIRMED",
          waitlistPos,
        },
      });

      if (saleContext) {
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
        ...(saleContext ? { paymentMethod: saleContext.method, paymentMethodId: saleContext.paymentMethodId } : {}),
      },
    });

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
    const registration = await prisma.openPlayNightRegistration.create({
      data: {
        sessionId: null,
        date,
        playerId: input.playerId,
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
      await tx.openPlayWaitlistEntry.update({ where: { id: stale.id }, data: { status: "EXPIRED" } });
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
        throw new Error(`Cannot transition waitlist entry ${nextWaiting.id} from WAITING to INVITED.`);
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
        logger.error({ error, waitlistEntryId: nextWaiting.id }, "Failed to send open-play waitlist invite SMS");
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
  // (getCheckInScreenData), not on a schedule. Cheap pre-check outside
  // any transaction/lock first, same shape as reconcileNoShows' own
  // cutoff check, so a normal read that has nothing to reconcile doesn't
  // pay for a session lock it doesn't need.
  async reconcileExpiredInvites(sessionId: string, actorUserId: string | null): Promise<void> {
    const session = await prisma.openPlayNightSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      return;
    }

    const staleInvite = await prisma.openPlayWaitlistEntry.findFirst({
      where: { sessionId, status: "INVITED", inviteExpiresAt: { lt: new Date() } },
      select: { id: true },
    });
    if (!staleInvite) {
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

  async cancelRegistration(registrationId: string, actorUserId: string): Promise<OpenPlayNightRegistration> {
    return this.releaseRegistration(registrationId, "CANCELLED", actorUserId);
  }

  // actorUserId is nullable here specifically for reconcileNoShows'
  // system-driven auto-release (BUILD-SPEC.md §6 "No-shows") — every
  // staff-initiated call site still passes a real user id.
  async markNoShow(registrationId: string, actorUserId: string | null): Promise<OpenPlayNightRegistration> {
    return this.releaseRegistration(registrationId, "NO_SHOW", actorUserId);
  }

  async markCheckedOut(registrationId: string, actorUserId: string): Promise<OpenPlayNightRegistration> {
    return this.releaseRegistration(registrationId, "CHECKED_OUT", actorUserId);
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
      const existing = await tx.openPlayNightRegistration.findUniqueOrThrow({ where: { id: registrationId } });

      // Weeknight (sessionId null) has no capacity/waitlist at all — just
      // flip the status, nothing to lock or promote.
      if (!existing.sessionId) {
        return tx.openPlayNightRegistration.update({
          where: { id: registrationId },
          data: {
            status,
            checkedOutAt: status === "CHECKED_OUT" ? new Date() : existing.checkedOutAt,
          },
        });
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
      const current = await tx.openPlayNightRegistration.findUniqueOrThrow({ where: { id: registrationId } });
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
      const releasableStatuses: (typeof current.status)[] = ["CONFIRMED", "AWAITING_PAYMENT", "PENDING_VERIFICATION"];
      if (!releasableStatuses.includes(current.status)) {
        // Already released by a concurrent (or earlier) call — idempotent
        // no-op, same treatment as check-in's double-tap.
        return current;
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
          await this.inviteNextWaitlistEntry(tx, { id: existing.sessionId, date: existing.date }, actorUserId);
        }
      } else if (releasedWaitlistPos !== null) {
        // Released registration was itself waitlisted, not seated — no
        // promotion, just close the gap behind it.
        await tx.openPlayNightRegistration.updateMany({
          where: { sessionId: existing.sessionId, waitlistPos: { gt: releasedWaitlistPos } },
          data: { waitlistPos: { decrement: 1 } },
        });
      }

      return updated;
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_night_registration.released",
      entityType: "OpenPlayNightRegistration",
      entityId: released.id,
      newValues: { status },
    });

    return released;
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
      logger.error({ err: error, action: entry.action, userId: entry.actorUserId }, "Failed to write audit log entry");
    }
  }
}

export const openPlayRegistrationService = new OpenPlayRegistrationService();
