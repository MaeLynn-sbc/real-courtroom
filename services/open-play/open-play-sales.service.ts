import { prisma } from "@/lib/prisma";

// BUILD-SPEC.md §9 "Sales summary — grouped by businessDate, so an
// 11:30PM game lands on the right night." PlayerTab.date already *is*
// the correct business-shaped grouping key — it's the same `date` field
// used throughout open play (an OpenPlayNightSession's date for Fri/Sat,
// or the plain calendar date for a weeknight), set once at tab creation
// and never drifting from the night the games were actually played. That
// means this summary doesn't need to reconstruct businessDate from
// timestamps the way a general Sale-createdAt query would — grouping by
// `PlayerTab.date` directly is both simpler and more correct here.
//
// Reads TabLineItems (not just Sale.amountCents) so games/rentals/
// adjustments can be broken out separately, per §9's breakdown — a
// settled tab's Sale row only records the net total, not its shape.

export interface OpenPlaySalesSummary {
  from: Date;
  to: Date;
  weeknightGameRevenueCents: number;
  weeknightGameCount: number;
  equipmentRentalRevenueCents: number;
  // Open-play queue/tabs screen batch: "+ Add-on" line items (Water,
  // Grip Tape, Paddle Rental, ... — the Product catalog), tracked
  // separately from equipment rentals since they're a different kind of
  // charge (a one-time consumable sale, not gear lent out).
  addOnRevenueCents: number;
  // Net of discounts and void reversals — typically negative or zero.
  adjustmentsCents: number;
  // weeknightGameRevenueCents + equipmentRentalRevenueCents +
  // addOnRevenueCents + adjustmentsCents, i.e. what actually got charged
  // and settled. Write-offs are excluded — §9 "write-offs never count
  // as revenue."
  netRevenueCents: number;
  writeOffCents: number;
  writeOffCount: number;
  // Per-write-off detail — BUILD-SPEC.md §9 review: "no anonymous
  // write-offs" isn't just a write-time check, it must be visible after
  // the fact too. Employee name and reason shown together so staff/owner
  // can actually audit who wrote off what and why, not just a total.
  writeOffs: {
    tabId: string;
    playerName: string;
    amountCents: number;
    reason: string;
    employeeName: string;
  }[];
  byPaymentMethod: { paymentMethodId: string; label: string; amountCents: number; count: number }[];
  unsettledCount: number;
  unsettledTotalCents: number;
  // BUILD-SPEC.md §9 "Fri/Sat ₱150 registrations," broken out here.
  // Gate 2 review follow-up: this used to be hardcoded 0 with a note
  // that the fee wasn't recorded anywhere yet — registerWalkIn now
  // creates a real Sale (Sale.openPlayNightRegistrationId) for it, so
  // this is a genuine aggregate, included in byPaymentMethod and
  // netRevenueCents below, not a separate, excluded bucket anymore.
  friSatRegistrationFeeCents: number;
  friSatRegistrationFeeCount: number;
}

export class OpenPlaySalesService {
  async getSummary(from: Date, to: Date): Promise<OpenPlaySalesSummary> {
    const tabs = await prisma.playerTab.findMany({
      where: { date: { gte: from, lte: to } },
      include: { lineItems: true, writeOffEmployee: true },
    });

    let weeknightGameRevenueCents = 0;
    let weeknightGameCount = 0;
    let equipmentRentalRevenueCents = 0;
    let addOnRevenueCents = 0;
    let adjustmentsCents = 0;
    let writeOffCents = 0;
    let writeOffCount = 0;
    let unsettledCount = 0;
    let unsettledTotalCents = 0;
    const settledTabIds: string[] = [];
    const writeOffs: OpenPlaySalesSummary["writeOffs"] = [];

    for (const tab of tabs) {
      const totalCents = tab.lineItems.reduce((sum, item) => sum + item.amountCents, 0);

      if (tab.status === "SETTLED") {
        settledTabIds.push(tab.id);
        for (const item of tab.lineItems) {
          if (item.type === "GAME") {
            weeknightGameRevenueCents += item.amountCents;
            weeknightGameCount += item.qtyOrGames;
          } else if (item.type === "RENTAL") {
            equipmentRentalRevenueCents += item.amountCents;
          } else if (item.type === "PRODUCT") {
            addOnRevenueCents += item.amountCents;
          } else {
            adjustmentsCents += item.amountCents;
          }
        }
      } else if (tab.status === "WRITTEN_OFF") {
        writeOffCents += totalCents;
        writeOffCount += 1;
        writeOffs.push({
          tabId: tab.id,
          playerName: tab.playerName,
          amountCents: totalCents,
          reason: tab.writeOffReason ?? "",
          employeeName: tab.writeOffEmployee ? `${tab.writeOffEmployee.firstName} ${tab.writeOffEmployee.lastName}` : "Unknown",
        });
      } else if (tab.status === "OPEN" && totalCents > 0) {
        unsettledCount += 1;
        unsettledTotalCents += totalCents;
      }
    }

    const tabSales = await prisma.sale.findMany({
      where: { category: "OPEN_PLAY", status: "COMPLETED", playerTabId: { in: settledTabIds } },
      include: { paymentMethod: true },
    });

    // Gate 2 review follow-up: the Fri/Sat registration fee's own Sales
    // — a DIFFERENT linked-record shape (openPlayNightRegistrationId,
    // not playerTabId), scoped by the registration's own `date` column,
    // the exact same "grouping key" reasoning this file's own top
    // comment already gives for why PlayerTab.date (not Sale.createdAt)
    // is used above.
    const registrationFeeSales = await prisma.sale.findMany({
      where: {
        category: "OPEN_PLAY",
        status: "COMPLETED",
        openPlayNightRegistrationId: { not: null },
        openPlayNightRegistration: { date: { gte: from, lte: to } },
      },
      include: { paymentMethod: true },
    });
    const friSatRegistrationFeeCents = registrationFeeSales.reduce((sum, sale) => sum + sale.amountCents, 0);
    const friSatRegistrationFeeCount = registrationFeeSales.length;

    const sales = [...tabSales, ...registrationFeeSales];
    const byPaymentMethodMap = new Map<string, { paymentMethodId: string; label: string; amountCents: number; count: number }>();
    for (const sale of sales) {
      const existing = byPaymentMethodMap.get(sale.paymentMethodId);
      if (existing) {
        existing.amountCents += sale.amountCents;
        existing.count += 1;
      } else {
        byPaymentMethodMap.set(sale.paymentMethodId, {
          paymentMethodId: sale.paymentMethodId,
          label: sale.paymentMethod.label,
          amountCents: sale.amountCents,
          count: 1,
        });
      }
    }

    return {
      from,
      to,
      weeknightGameRevenueCents,
      weeknightGameCount,
      equipmentRentalRevenueCents,
      addOnRevenueCents,
      adjustmentsCents,
      netRevenueCents:
        weeknightGameRevenueCents + equipmentRentalRevenueCents + addOnRevenueCents + adjustmentsCents + friSatRegistrationFeeCents,
      writeOffCents,
      writeOffCount,
      writeOffs,
      byPaymentMethod: Array.from(byPaymentMethodMap.values()).sort((a, b) => b.amountCents - a.amountCents),
      unsettledCount,
      unsettledTotalCents,
      friSatRegistrationFeeCents,
      friSatRegistrationFeeCount,
    };
  }
}

export const openPlaySalesService = new OpenPlaySalesService();
