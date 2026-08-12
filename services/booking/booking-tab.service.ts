import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { BookingTab, BookingTabLineItem, Prisma } from "@/lib/generated/prisma/client";
import { saleService } from "@/services/sales/sale.service";

// Add-ons (paddle rentals, shop items) for a court booking — mirrors
// services/open-play/player-tab.service.ts's shape closely (append-only
// line items, lock-then-transact concurrency, settle-once), but keyed to
// a Booking instead of an OpenPlayNightRegistration. See BookingTab's own
// schema comment for why this is a separate service/model rather than a
// PlayerTab retrofit.
//
// settleTab below creates ONE Sale PER PRODUCT line item (category
// PRODUCT, productId set) — this tab was built with that shape from
// day one, before PlayerTab's own settleTab (migration 71, 2026-08-12)
// caught up to the same split for open play's add-ons.

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

export interface BookingTabLineItemRow extends BookingTabLineItem {
  voided: boolean;
}

export interface BookingTabView {
  tab: BookingTab;
  lineItems: BookingTabLineItemRow[];
  totalCents: number;
}

export interface BookingTabSaleContext {
  employeeId: string;
  shiftId: string;
  paymentMethodId: string;
}

export class BookingTabService {
  // Idempotent, same precedent as playerTabService.getOrCreateTab —
  // accepts an optional transaction client so addProductLineItem can
  // include tab creation atomically with its first charge.
  async getOrCreateTab(
    bookingId: string,
    actorUserId: string | null,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<BookingTab> {
    const existing = await client.bookingTab.findUnique({ where: { bookingId } });
    if (existing) {
      return existing;
    }

    const tab = await client.bookingTab.create({ data: { bookingId } });

    await this.writeAuditLog({
      actorUserId,
      action: "booking_tab.created",
      entityType: "BookingTab",
      entityId: tab.id,
      newValues: { bookingId },
    });

    return tab;
  }

  // Same "lock the tab row first" fix player-tab.service.ts's own
  // lockAndCheckTabOpen carries — a charge added in the window between a
  // stale read and settleTab's own transaction must not land unbilled.
  private async lockAndCheckTabOpen(
    tx: Prisma.TransactionClient,
    tabId: string,
  ): Promise<BookingTab> {
    await tx.$queryRaw`SELECT id FROM "BookingTab" WHERE id = ${tabId} FOR UPDATE`;
    const tab = await tx.bookingTab.findUniqueOrThrow({ where: { id: tabId } });
    if (tab.status !== "OPEN") {
      throw new Error(`Cannot add a charge to a tab that is already ${tab.status.toLowerCase()}.`);
    }
    return tab;
  }

  // Stock decrements HERE, atomically, in the same transaction as the
  // line item — not deferred to settlement. Stock physically leaves the
  // shelf when the item is handed over, which is when this is called,
  // not whenever the tab eventually gets settled (which could be hours
  // later, or span a shift change). Same atomic-guard shape as
  // productService.sellProduct's own decrement.
  async addProductLineItem(
    bookingId: string,
    productId: string,
    qty: number,
    actorUserId: string,
  ): Promise<BookingTabLineItem> {
    const lineItem = await prisma.$transaction(async (tx) => {
      const tab = await this.getOrCreateTab(bookingId, actorUserId, tx);
      await this.lockAndCheckTabOpen(tx, tab.id);

      const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
      if (!product.active) {
        throw new Error("This add-on isn't available.");
      }
      if (product.stockCount < qty) {
        throw new Error(`Not enough stock — only ${product.stockCount} of "${product.name}" left.`);
      }

      const claim = await tx.product.updateMany({
        where: { id: productId, stockCount: { gte: qty } },
        data: { stockCount: { decrement: qty } },
      });
      if (claim.count === 0) {
        const current = await tx.product.findUniqueOrThrow({ where: { id: productId } });
        throw new Error(`Not enough stock — only ${current.stockCount} of "${current.name}" left.`);
      }

      return tx.bookingTabLineItem.create({
        data: {
          tabId: tab.id,
          type: "PRODUCT",
          description: product.name,
          qtyOrGames: qty,
          unitPriceCents: product.priceCents,
          amountCents: product.priceCents * qty,
          productId: product.id,
          createdByUserId: actorUserId,
        },
      });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "booking_tab.product_added",
      entityType: "BookingTab",
      entityId: lineItem.tabId,
      newValues: { productId, qty, amountCents: lineItem.amountCents },
    });

    return lineItem;
  }

  // "Never edit or delete an existing line item" — voiding is a new,
  // offsetting ADJUSTMENT row, not a mutation. Restores the stock this
  // line item decremented, in the same transaction — the item is
  // physically back in hand (or was never actually handed over), same
  // reasoning as the decrement happening at add-time in the first place.
  async voidLineItem(
    bookingId: string,
    lineItemId: string,
    reason: string,
    actorUserId: string,
  ): Promise<BookingTabLineItem> {
    if (!reason.trim()) {
      throw new Error("A reason is required to void a charge.");
    }

    const lineItem = await prisma.$transaction(async (tx) => {
      const tab = await tx.bookingTab.findUnique({ where: { bookingId } });
      if (!tab) {
        throw new Error("This booking has no add-ons tab.");
      }
      await this.lockAndCheckTabOpen(tx, tab.id);

      const original = await tx.bookingTabLineItem.findUniqueOrThrow({
        where: { id: lineItemId },
        include: { voidedByItems: true },
      });
      if (original.tabId !== tab.id) {
        throw new Error("That line item doesn't belong to this booking.");
      }
      if (original.voidedByItems.length > 0) {
        throw new Error("That charge has already been voided.");
      }

      if (original.type === "PRODUCT" && original.productId) {
        await tx.product.update({
          where: { id: original.productId },
          data: { stockCount: { increment: original.qtyOrGames } },
        });
      }

      return tx.bookingTabLineItem.create({
        data: {
          tabId: tab.id,
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
      action: "booking_tab.line_item_voided",
      entityType: "BookingTab",
      entityId: lineItem.tabId,
      oldValues: { voidedLineItemId: lineItemId },
    });

    return lineItem;
  }

  async getTabViewByBooking(bookingId: string): Promise<BookingTabView | null> {
    const tab = await prisma.bookingTab.findUnique({ where: { bookingId } });
    if (!tab) {
      return null;
    }
    const rows = await prisma.bookingTabLineItem.findMany({
      where: { tabId: tab.id },
      include: { voidedByItems: true },
      orderBy: { createdAt: "asc" },
    });
    // voidedByItems.length > 0 means a later ADJUSTMENT row already
    // offsets this one — same active/voided distinction
    // playerTabService.buildView's own lineItems don't bother computing
    // (that panel shows every row flat), but this panel hides a voided
    // original rather than showing both the charge and its own reversal
    // as two separate lines.
    const lineItems: BookingTabLineItemRow[] = rows.map(({ voidedByItems, ...item }) => ({
      ...item,
      voided: voidedByItems.length > 0,
    }));
    const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);
    return { tab, lineItems, totalCents };
  }

  // Creates ONE Sale per active (non-voided) PRODUCT line item, all
  // inside one transaction, all sharing the same payment method/
  // employee/shift — one settlement, one payment-method choice, but
  // revenue attributed per product so it lands correctly on the Shop
  // Products report. Completely independent of the booking's own
  // court-fee Sale (Sale.bookingId) — never read, never touched here.
  // Same total-computed-inside-the-transaction fix as
  // playerTabService.settleTab (its own comment explains the exact race
  // this closes: a charge landing between a stale pre-transaction total
  // read and the write).
  async settleTab(
    bookingId: string,
    method: "CASH" | "GCASH",
    gcashReference: string | null,
    saleContext: BookingTabSaleContext,
    actorUserId: string,
  ): Promise<BookingTab> {
    if (method === "GCASH" && !gcashReference?.trim()) {
      throw new Error("A GCash reference number is required.");
    }

    const precheck = await prisma.bookingTab.findUnique({ where: { bookingId } });
    if (!precheck) {
      throw new Error("This booking has no add-ons tab.");
    }
    if (precheck.status !== "OPEN") {
      throw new Error(`Tab is already ${precheck.status.toLowerCase()}.`);
    }

    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.bookingTab.updateMany({
        where: { id: precheck.id, status: "OPEN" },
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
      const updated = await tx.bookingTab.findUniqueOrThrow({ where: { id: precheck.id } });

      // Computed inside the transaction, after the row is claimed — see
      // this method's own doc comment for why.
      const lineItems = await tx.bookingTabLineItem.findMany({
        where: { tabId: precheck.id },
        include: { voidedByItems: true },
      });
      const activeProductItems = lineItems.filter(
        (item) => item.type === "PRODUCT" && item.voidedByItems.length === 0,
      );

      const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });

      let totalCents = 0;
      for (const item of activeProductItems) {
        totalCents += item.amountCents;
        await saleService.createSale(
          {
            category: "PRODUCT",
            amountCents: item.amountCents,
            paymentMethodId: saleContext.paymentMethodId,
            employeeId: saleContext.employeeId,
            shiftId: saleContext.shiftId,
            playerId: booking.playerId ?? undefined,
            productId: item.productId ?? undefined,
            bookingTabId: precheck.id,
            description:
              item.qtyOrGames > 1 ? `${item.description} x${item.qtyOrGames}` : item.description,
          },
          tx,
        );
      }

      return { tab: updated, totalCents };
    });

    await this.writeAuditLog({
      actorUserId,
      action: "booking_tab.settled",
      entityType: "BookingTab",
      entityId: precheck.id,
      newValues: { method, totalCents: result.totalCents },
    });

    return result.tab;
  }

  // No Sale created — reported separately from real revenue, same "no
  // anonymous write-offs" rule as playerTabService.writeOffTab.
  async writeOffTab(
    bookingId: string,
    reason: string,
    employeeId: string,
    actorUserId: string,
  ): Promise<BookingTab> {
    if (!reason.trim()) {
      throw new Error("A reason is required to write off a tab.");
    }
    if (!employeeId) {
      throw new Error("An employee must be attributed to a write-off.");
    }

    const precheck = await prisma.bookingTab.findUnique({ where: { bookingId } });
    if (!precheck) {
      throw new Error("This booking has no add-ons tab.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const claim = await tx.bookingTab.updateMany({
        where: { id: precheck.id, status: "OPEN" },
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
      return tx.bookingTab.findUniqueOrThrow({ where: { id: precheck.id } });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "booking_tab.written_off",
      entityType: "BookingTab",
      entityId: precheck.id,
      newValues: { reason, employeeId },
    });

    return updated;
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

export const bookingTabService = new BookingTabService();
