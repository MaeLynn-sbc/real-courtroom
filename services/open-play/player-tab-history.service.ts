import { prisma } from "@/lib/prisma";
import type { PlayerTabStatus, TabSettlementMethod } from "@/lib/generated/prisma/enums";
import type { DateRange } from "@/services/analytics/date-range";

export interface PlayerTabHistoryRow {
  id: string;
  date: Date;
  playerName: string;
  status: PlayerTabStatus;
  totalCents: number;
  settledAt: Date | null;
  settledVia: TabSettlementMethod | null;
  settledByName: string | null;
  writeOffReason: string | null;
  writeOffEmployeeName: string | null;
}

// Owner request (2026-08-12): "kindly build history also of player
// tabs. daily so we will know all the details" — a real cross-day list
// of every Open Play tab, not just one date's roster the way
// playerTabService.listTabsForDate already covers (see that method's
// own comment — this is a genuinely new query shape, not a duplicate).
// Deliberately a separate file from player-tab.service.ts, same split
// as open-play-sales.service.ts (a read-only reporting concern) versus
// the transactional tab-mutation service.
export class PlayerTabHistoryService {
  // take: 500 — same cap reportingService.getBookingReport already uses
  // for range queries; a wide date range on a busy facility could
  // otherwise return an unbounded result set.
  async listTabsInRange(range: DateRange): Promise<PlayerTabHistoryRow[]> {
    const tabs = await prisma.playerTab.findMany({
      where: { date: { gte: range.from, lte: range.to } },
      include: { lineItems: true, writeOffEmployee: true },
      orderBy: { date: "desc" },
      take: 500,
    });

    // PlayerTab.settledByUserId has no Prisma relation to User (unlike
    // writeOffEmployeeId's real writeOffEmployee relation) — nothing
    // else in the app resolves it today, so this is a fresh batched
    // lookup, not reuse of an existing pattern.
    const settledByUserIds = [...new Set(tabs.map((tab) => tab.settledByUserId).filter((id): id is string => id !== null))];
    const settlers = settledByUserIds.length
      ? await prisma.user.findMany({ where: { id: { in: settledByUserIds } }, select: { id: true, name: true, email: true } })
      : [];
    const settlerNameById = new Map(settlers.map((user) => [user.id, user.name ?? user.email ?? "Unknown"]));

    return tabs.map((tab) => ({
      id: tab.id,
      date: tab.date,
      playerName: tab.playerName,
      status: tab.status,
      totalCents: tab.lineItems.reduce((sum, item) => sum + item.amountCents, 0),
      settledAt: tab.settledAt,
      settledVia: tab.settledVia,
      settledByName: tab.settledByUserId ? (settlerNameById.get(tab.settledByUserId) ?? "Unknown") : null,
      writeOffReason: tab.writeOffReason,
      writeOffEmployeeName: tab.writeOffEmployee
        ? `${tab.writeOffEmployee.firstName} ${tab.writeOffEmployee.lastName}`
        : null,
    }));
  }
}

export const playerTabHistoryService = new PlayerTabHistoryService();
