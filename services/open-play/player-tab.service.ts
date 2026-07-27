import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { PlayerTab, Prisma, TabLineItem } from "@/lib/generated/prisma/client";
import { equipmentService } from "@/services/equipment/equipment.service";
import { productService } from "@/services/products/product.service";
import { saleService } from "@/services/sales/sale.service";
import { settingsService } from "@/services/settings/settings.service";

// BUILD-SPEC.md §9 "Player tabs, settlement, and sales." One PlayerTab per
// registration, created on demand (getOrCreateTab), not at a single fixed
// moment — checkIn opens one for every checked-in player (both night
// types), and completeAssignment/addRentalLineItem defensively get-or-create
// one too, so a tab always exists by the time something needs to bill it
// regardless of call order.

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

export interface PlayerTabView {
  tab: PlayerTab;
  lineItems: TabLineItem[];
  // BUILD-SPEC.md §9 correctness #1 "Game counts derive from assignment
  // rows, never a stored counter" — counted directly from
  // GameAssignmentParticipant/DONE assignments, independent of whatever
  // GAME-type TabLineItems exist for billing. They should always agree
  // (completeAssignment creates exactly one of each per participant), but
  // this can never drift even if a line item were somehow missing.
  gamesPlayed: number;
  totalCents: number;
}

export interface SaleContext {
  employeeId: string;
  shiftId: string;
  paymentMethodId: string;
}

async function computeGameRateCents(
  registration: { sessionId: string | null },
): Promise<number> {
  // Fri/Sat games are "counted for rotation fairness, billed at ₱0" (§9) —
  // the flat ₱150 fee is a separate, not-yet-built §8 payment, not a tab
  // line item.
  if (registration.sessionId) {
    return 0;
  }
  const settings = await settingsService.getOpenPlaySettings();
  return settings.weeknightGameRateCents;
}

export class PlayerTabService {
  // Idempotent — same precedent as getOrCreateSessionForDate. Accepts an
  // optional transaction client so callers already inside a transaction
  // (completeAssignment, checkIn) can include tab creation atomically.
  async getOrCreateTab(
    registrationId: string,
    actorUserId: string | null,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<PlayerTab> {
    const existing = await client.playerTab.findUnique({ where: { registrationId } });
    if (existing) {
      return existing;
    }

    const registration = await client.openPlayNightRegistration.findUniqueOrThrow({ where: { id: registrationId } });
    const gameRateCents = await computeGameRateCents(registration);

    const tab = await client.playerTab.create({
      data: {
        date: registration.date,
        sessionId: registration.sessionId,
        registrationId,
        playerName: registration.playerName,
        gameRateCents,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "player_tab.created",
      entityType: "PlayerTab",
      entityId: tab.id,
      newValues: { registrationId, gameRateCents },
    });

    return tab;
  }

  // BUILD-SPEC.md §9 "Every GameAssignment reaching status done credits one
  // game to each of its 4 players." Called from
  // open-play-rotation.service.ts's completeAssignment, inside the same
  // transaction as the DONE transition — never independently, so a game
  // can't be marked done without also billing it (or vice versa).
  // Idempotent via the @@unique([tabId, gameAssignmentId]) constraint: a
  // retried call can't double-credit the same assignment.
  async creditGame(
    registrationId: string,
    gameAssignmentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const tab = await this.getOrCreateTab(registrationId, null, tx);

    // Idempotent, but void-aware: a GAME row for this assignment that has
    // since been fully voided (voidedByItems.length > 0) must NOT block a
    // legitimate new credit — only an active, un-voided GAME row does.
    // Without this distinction, voiding a mis-credited game and then
    // legitimately re-crediting the same assignment would silently no-op
    // here (the old row "exists"), and the player would play for free
    // with no error. The original row is never touched either way — see
    // voidsLineItemId's comment in schema.prisma.
    //
    // This check is application-level, not database-enforced (there's no
    // unique constraint on tabId+gameAssignmentId — see the same comment
    // for why one can't express "unique among non-voided rows"). That's
    // only safe because the ONLY caller, completeAssignment, takes a
    // `SELECT ... FOR UPDATE` lock on the GameAssignment row before ever
    // reaching this method — see that method's comment. Two concurrent
    // completeAssignment calls for the same assignment can't both be
    // "inside" this method at once; the second blocks on the lock, then
    // sees status=DONE and never calls creditGame at all. Proven live:
    // player-tab.concurrency.integration.ts fires 10 concurrent
    // completeAssignment calls against one assignment and asserts exactly
    // one ₱35 credit lands — failed 10/10 before the lock existed. If
    // creditGame ever gets a second caller that doesn't hold that same
    // lock, this idempotency check stops being safe under concurrency and
    // needs revisiting alongside that caller.
    const existingCredits = await tx.tabLineItem.findMany({
      where: { tabId: tab.id, gameAssignmentId, type: "GAME" },
      include: { voidedByItems: true },
    });
    const activeCredit = existingCredits.find((item) => item.voidedByItems.length === 0);
    if (activeCredit) {
      return;
    }

    await tx.tabLineItem.create({
      data: {
        tabId: tab.id,
        type: "GAME",
        description: "Game",
        qtyOrGames: 1,
        unitPriceCents: tab.gameRateCents,
        amountCents: tab.gameRateCents,
        gameAssignmentId,
      },
    });
  }

  // Hardening phase fix (BUILD-SPEC.md §0 process rule): shared by
  // addRentalLineItem/addAdjustment/voidLineItem below. The tab-is-OPEN
  // check used to be a plain read, not atomic with settleTab/writeOffTab's
  // guarded update — a charge added in that window could land after a
  // racing settlement already computed its total, silently unbilled.
  // Proven live (player-tab.concurrency.race.integration.ts): a settled
  // tab ended up with a ₱20 balance and NO corresponding Sale at all,
  // every run, before this fix. Locking the PlayerTab row first means
  // this and settleTab/writeOffTab's own atomic update can't both act on
  // it at once — whichever gets there first, the other waits and then
  // sees the fresh (already-settled) state.
  private async lockAndCheckTabOpen(tx: Prisma.TransactionClient, tabId: string): Promise<PlayerTab> {
    await tx.$queryRaw`SELECT id FROM "PlayerTab" WHERE id = ${tabId} FOR UPDATE`;
    const tab = await tx.playerTab.findUniqueOrThrow({ where: { id: tabId } });
    if (tab.status !== "OPEN") {
      throw new Error(`Cannot add a charge to a tab that is already ${tab.status.toLowerCase()}.`);
    }
    return tab;
  }

  // Hardening phase fix, the other half of closeSession's own fix
  // (open-play-capacity.service.ts): closeSession's atomic conditional
  // UPDATE closes the gap between "check" and "write" on ITS side, but
  // does nothing to stop a NEW charge landing on one of its tabs
  // immediately AFTER it closes — found via this exact test scenario,
  // not assumed: fixing closeSession alone left
  // open-play-capacity.concurrency.integration.ts still failing. Locking
  // the session row here means a concurrent closeSession (which also
  // locks that row as part of its own UPDATE) and this call serialize
  // properly — whichever wins, the other sees the fresh state.
  private async assertSessionNotClosed(tx: Prisma.TransactionClient, sessionId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "OpenPlayNightSession" WHERE id = ${sessionId} FOR UPDATE`;
    const session = await tx.openPlayNightSession.findUniqueOrThrow({ where: { id: sessionId } });
    if (session.status !== "OPEN") {
      throw new Error("Cannot add a charge — this session has already closed.");
    }
  }

  // "Equipment rentals (paddle ₱20) attach to the same tab" — reads the
  // current price from the Equipment record (never hardcoded), same
  // precedent as the public site's paddle-rental price.
  async addRentalLineItem(
    tabId: string,
    equipmentKey: string,
    description: string,
    qty: number,
    actorUserId: string,
  ): Promise<TabLineItem> {
    const unitPriceCents = await equipmentService.getRentalRateCentsByKey(equipmentKey);
    if (unitPriceCents === null) {
      throw new Error(`Equipment "${equipmentKey}" not found.`);
    }

    const lineItem = await prisma.$transaction(async (tx) => {
      const tab = await this.lockAndCheckTabOpen(tx, tabId);
      if (tab.sessionId) {
        await this.assertSessionNotClosed(tx, tab.sessionId);
      }

      return tx.tabLineItem.create({
        data: {
          tabId,
          type: "RENTAL",
          description,
          qtyOrGames: qty,
          unitPriceCents,
          amountCents: unitPriceCents * qty,
          createdByUserId: actorUserId,
        },
      });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "player_tab.rental_added",
      entityType: "PlayerTab",
      entityId: tabId,
      newValues: { equipmentKey, qty, amountCents: lineItem.amountCents },
    });

    return lineItem;
  }

  // Open-play queue/tabs screen batch: "+ Add-on" — same shape as
  // addRentalLineItem immediately above, sourcing its price from the
  // Product catalog instead of Equipment (see product.service.ts's
  // getActiveProductPriceCents). Distinct TabLineItemType ("PRODUCT",
  // not "RENTAL") so these show up as what they are — a one-time
  // consumable sale, not equipment rental — without touching the
  // RENTAL path at all.
  async addProductLineItem(tabId: string, productId: string, qty: number, actorUserId: string): Promise<TabLineItem> {
    const product = await productService.getActiveProductPriceCents(productId);
    if (!product) {
      throw new Error("This add-on isn't available.");
    }

    const lineItem = await prisma.$transaction(async (tx) => {
      const tab = await this.lockAndCheckTabOpen(tx, tabId);
      if (tab.sessionId) {
        await this.assertSessionNotClosed(tx, tab.sessionId);
      }

      return tx.tabLineItem.create({
        data: {
          tabId,
          type: "PRODUCT",
          description: product.name,
          qtyOrGames: qty,
          unitPriceCents: product.priceCents,
          amountCents: product.priceCents * qty,
          createdByUserId: actorUserId,
        },
      });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "player_tab.product_added",
      entityType: "PlayerTab",
      entityId: tabId,
      newValues: { productId, qty, amountCents: lineItem.amountCents },
    });

    return lineItem;
  }

  // BUILD-SPEC.md §9 "Staff can add an adjustment (discount, correction)
  // with a required reason." amountCents can be negative (a discount) or
  // positive (a correction that adds to the tab).
  async addAdjustment(tabId: string, description: string, amountCents: number, reason: string, actorUserId: string): Promise<TabLineItem> {
    if (!reason.trim()) {
      throw new Error("A reason is required for an adjustment.");
    }

    const lineItem = await prisma.$transaction(async (tx) => {
      const tab = await this.lockAndCheckTabOpen(tx, tabId);
      if (tab.sessionId) {
        await this.assertSessionNotClosed(tx, tab.sessionId);
      }

      return tx.tabLineItem.create({
        data: {
          tabId,
          type: "ADJUSTMENT",
          description,
          qtyOrGames: 1,
          unitPriceCents: amountCents,
          amountCents,
          reason,
          createdByUserId: actorUserId,
        },
      });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "player_tab.adjustment_added",
      entityType: "PlayerTab",
      entityId: tabId,
      newValues: { description, amountCents, reason },
    });

    return lineItem;
  }

  // "Never edit or delete an existing line item" — voiding a charge (e.g.
  // a mis-credited game) is a new, offsetting ADJUSTMENT row, not a
  // mutation or deletion of the original. Only needs the tab-lock, not
  // the session-not-closed check — a void only ever reduces a tab's
  // balance, which can never be the thing that makes closeSession wrongly
  // let a session through with money outstanding.
  async voidLineItem(tabId: string, lineItemId: string, reason: string, actorUserId: string): Promise<TabLineItem> {
    if (!reason.trim()) {
      throw new Error("A reason is required to void a charge.");
    }

    const lineItem = await prisma.$transaction(async (tx) => {
      await this.lockAndCheckTabOpen(tx, tabId);

      const original = await tx.tabLineItem.findUniqueOrThrow({
        where: { id: lineItemId },
        include: { voidedByItems: true },
      });
      if (original.tabId !== tabId) {
        throw new Error("That line item doesn't belong to this tab.");
      }
      if (original.voidedByItems.length > 0) {
        throw new Error("That charge has already been voided.");
      }

      return tx.tabLineItem.create({
        data: {
          tabId,
          type: "ADJUSTMENT",
          description: `Void: ${original.description}`,
          qtyOrGames: 1,
          unitPriceCents: -original.amountCents,
          amountCents: -original.amountCents,
          reason,
          createdByUserId: actorUserId,
          voidsLineItemId: lineItemId,
        },
      });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "player_tab.line_item_voided",
      entityType: "PlayerTab",
      entityId: tabId,
      oldValues: { voidedLineItemId: lineItemId },
    });

    return lineItem;
  }

  async getTabView(tabId: string): Promise<PlayerTabView> {
    const tab = await prisma.playerTab.findUniqueOrThrow({ where: { id: tabId } });
    return this.buildView(tab);
  }

  async getTabViewByRegistration(registrationId: string): Promise<PlayerTabView | null> {
    const tab = await prisma.playerTab.findUnique({ where: { registrationId } });
    if (!tab) {
      return null;
    }
    return this.buildView(tab);
  }

  private async buildView(tab: PlayerTab): Promise<PlayerTabView> {
    const [lineItems, gamesPlayed] = await Promise.all([
      prisma.tabLineItem.findMany({ where: { tabId: tab.id }, orderBy: { createdAt: "asc" } }),
      prisma.gameAssignmentParticipant.count({
        where: { registrationId: tab.registrationId, assignment: { status: "DONE" } },
      }),
    ]);
    const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);
    return { tab, lineItems, gamesPlayed, totalCents };
  }

  // BUILD-SPEC.md §9 "Settle asks for method — cash or GCash — then marks
  // paid." Creates a Sale (category OPEN_PLAY) through the same
  // Employee+Shift-backed revenue path every other module uses — never
  // `prisma.sale.create` directly. A ₱0 tab (checked in, nothing charged)
  // settles with no Sale row — there's nothing to record as revenue.
  //
  // Hardening phase fix (BUILD-SPEC.md §0 process rule): the amount being
  // settled used to be computed by getTabView BEFORE this transaction
  // even started, then trusted inside it. The `status: "OPEN"`-guarded
  // updateMany protected against a double-settle, but did nothing to
  // protect against a charge landing between that pre-transaction read
  // and the transaction itself — addRentalLineItem/addAdjustment's own
  // new row lock (see lockAndCheckTabOpen) forces them to wait for THIS
  // transaction to finish, but that alone doesn't help if this
  // transaction is working from a stale total it already captured before
  // either of them ran. Proven live
  // (player-tab.concurrency.race.integration.ts): a tab settled with a
  // ₱20 balance and NO Sale row at all — the stale pre-transaction read
  // saw ₱0 and skipped creating one. Fixed by computing the total INSIDE
  // this transaction, after the row is claimed — whichever of this or a
  // concurrent addRentalLineItem/addAdjustment wins the row lock first,
  // the other blocks and then sees the fully up-to-date state, so this
  // read is never stale relative to what actually got billed.
  async settleTab(
    tabId: string,
    method: "CASH" | "GCASH",
    gcashReference: string | null,
    saleContext: SaleContext,
    actorUserId: string,
  ): Promise<PlayerTab> {
    if (method === "GCASH" && !gcashReference?.trim()) {
      throw new Error("A GCash reference number is required.");
    }

    // Fast, friendly rejection for the common (non-racing) case only —
    // not load-bearing. The updateMany inside the transaction below is
    // what actually enforces "settle at most once."
    const precheck = await prisma.playerTab.findUniqueOrThrow({ where: { id: tabId } });
    if (precheck.status !== "OPEN") {
      throw new Error(`Tab is already ${precheck.status.toLowerCase()}.`);
    }

    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.playerTab.updateMany({
        where: { id: tabId, status: "OPEN" },
        data: {
          status: "SETTLED",
          settledAt: new Date(),
          settledByUserId: actorUserId,
          settledVia: method,
          gcashReference: method === "GCASH" ? gcashReference : null,
        },
      });
      if (claim.count === 0) {
        throw new Error("Tab is already settled.");
      }
      const updated = await tx.playerTab.findUniqueOrThrow({ where: { id: tabId } });

      // Computed here, not before the transaction — see the fix comment
      // above for why that distinction is load-bearing.
      const lineItems = await tx.tabLineItem.findMany({ where: { tabId } });
      const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);

      const registration = await tx.openPlayNightRegistration.findUniqueOrThrow({
        where: { id: updated.registrationId },
      });

      if (totalCents > 0) {
        await saleService.createSale(
          {
            category: "OPEN_PLAY",
            amountCents: totalCents,
            paymentMethodId: saleContext.paymentMethodId,
            employeeId: saleContext.employeeId,
            shiftId: saleContext.shiftId,
            playerId: registration.playerId ?? undefined,
            playerTabId: tabId,
            description: `Open play tab — ${updated.playerName}`,
          },
          tx,
        );
      }

      return { tab: updated, totalCents };
    });

    await this.writeAuditLog({
      actorUserId,
      action: "player_tab.settled",
      entityType: "PlayerTab",
      entityId: tabId,
      newValues: { method, totalCents: result.totalCents },
    });

    return result.tab;
  }

  // BUILD-SPEC.md §9 "Staff can write off a tab with a required reason —
  // reported separately from real revenue." No Sale row is created, so
  // this can never count as revenue by construction.
  // BUILD-SPEC.md §9 review: "no anonymous write-offs" — requires a real
  // Employee, not just the signed-in User, and a reason. Idempotent the
  // same way as settleTab: an atomic `status: "OPEN"`-guarded update
  // inside a transaction, not a check-then-act race.
  async writeOffTab(tabId: string, reason: string, employeeId: string, actorUserId: string): Promise<PlayerTab> {
    if (!reason.trim()) {
      throw new Error("A reason is required to write off a tab.");
    }
    if (!employeeId) {
      throw new Error("An employee must be attributed to a write-off.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const claim = await tx.playerTab.updateMany({
        where: { id: tabId, status: "OPEN" },
        data: {
          status: "WRITTEN_OFF",
          writeOffReason: reason,
          writeOffEmployeeId: employeeId,
          settledAt: new Date(),
          settledByUserId: actorUserId,
        },
      });
      if (claim.count === 0) {
        throw new Error("Tab is already settled or written off.");
      }
      return tx.playerTab.findUniqueOrThrow({ where: { id: tabId } });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "player_tab.written_off",
      entityType: "PlayerTab",
      entityId: tabId,
      newValues: { reason, employeeId },
    });

    return updated;
  }

  // BUILD-SPEC.md §9 "A player marked done with an open non-zero tab must
  // not close silently. They appear in an Unsettled list... until
  // resolved." Zero-total open tabs (checked in, never charged for
  // anything) are excluded — nothing to settle, nothing to nag about.
  async listUnsettledForDate(date: Date): Promise<(PlayerTab & { totalCents: number; gamesPlayed: number })[]> {
    const tabs = await this.listTabsForDate(date);
    return tabs.filter((tab) => tab.status === "OPEN" && tab.totalCents > 0);
  }

  // Every tab for the night regardless of status — powers the check-in
  // screen's Tabs panel (settle/adjust/write-off actions live there).
  async listTabsForDate(date: Date): Promise<(PlayerTab & { totalCents: number; gamesPlayed: number })[]> {
    const tabs = await prisma.playerTab.findMany({
      where: { date },
      include: { lineItems: true },
      orderBy: { playerName: "asc" },
    });

    const results: (PlayerTab & { totalCents: number; gamesPlayed: number })[] = [];
    for (const tab of tabs) {
      const totalCents = tab.lineItems.reduce((sum, item) => sum + item.amountCents, 0);
      const gamesPlayed = await prisma.gameAssignmentParticipant.count({
        where: { registrationId: tab.registrationId, assignment: { status: "DONE" } },
      });
      const { lineItems: _lineItems, ...tabFields } = tab;
      void _lineItems;
      results.push({ ...tabFields, totalCents, gamesPlayed });
    }
    return results;
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

export const playerTabService = new PlayerTabService();
