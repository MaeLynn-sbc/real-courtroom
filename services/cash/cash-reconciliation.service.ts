import type { CashDailyBalance, Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { saleService } from "@/services/sales/sale.service";

// Cash's twin of GcashReconciliationService (services/gcash/gcash-
// reconciliation.service.ts) — same date-scoped, one-shared-float
// shape, mirrored deliberately rather than generalized behind a single
// "PaymentMethodDailyBalance" abstraction (see CashDailyBalance's own
// schema comment for why). Date-scoped, not shift-scoped: cash here is
// one shared running float for the whole business, unlike Shift's own
// per-drawer opening/closing cash, which exists separately and is
// unaffected by this feature.
//
// The formula: starting balance + today's Cash sales = expected ending
// balance. Same as GCash, deliberately no refund/write-off subtraction
// term — a PlayerTab write-off creates no Sale row at all, and
// BookingRefund has no paymentMethodId and is never created anywhere in
// this codebase today, so there is nothing to subtract from cash
// specifically. If either of those changes, this formula needs
// revisiting then — flagged here, not silently ignored.

function toMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

interface AuditLogEntry {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

export class CashBalanceAlreadyConfirmedError extends Error {
  constructor() {
    super("This day's cash balance is already confirmed.");
    this.name = "CashBalanceAlreadyConfirmedError";
  }
}

// GCash's twin (services/gcash/gcash-reconciliation.service.ts's
// PriorDayNotClosedError) — same real incident (2026-08-07), same
// identical hole in this parallel implementation. Thrown, not returned
// as null — null already means "no CONFIRMED history at all yet."
export class PriorDayNotClosedError extends Error {
  constructor(public readonly priorDate: Date) {
    super(
      `${priorDate.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })} must be closed first.`,
    );
    this.name = "PriorDayNotClosedError";
  }
}

export class CashReconciliationService {
  async getBalanceForDate(date: Date): Promise<CashDailyBalance | null> {
    return prisma.cashDailyBalance.findUnique({ where: { date: toMidnight(date) } });
  }

  async listRecentBalances(limit = 14) {
    return prisma.cashDailyBalance.findMany({
      orderBy: { date: "desc" },
      take: limit,
      include: { confirmedByEmployee: true },
    });
  }

  // One-time only. There's no "yesterday" to carry forward from on day
  // one — this is the deliberate, explicit seam for that, not a
  // silent 0 default. Throws if ANY record already exists (seeded or
  // not), so it can never overwrite real history; the UI only offers
  // this when getOrCreateBalanceForDate reports none exists yet.
  async seedFirstBalance(
    startingBalanceCents: number,
    actorUserId: string,
  ): Promise<CashDailyBalance> {
    const anyExisting = await prisma.cashDailyBalance.findFirst();
    if (anyExisting) {
      throw new Error(
        "Cash reconciliation has already been started — the starting balance can't be re-seeded.",
      );
    }

    let balance: CashDailyBalance;
    try {
      balance = await prisma.cashDailyBalance.create({
        data: { date: toMidnight(new Date()), startingBalanceCents },
      });
    } catch (error) {
      // Same benign-race handling as GCash's own seedFirstBalance — two
      // concurrent first-time seed attempts both see "no existing row"
      // before either commits; the loser collides on the real unique
      // constraint instead of erroring.
      if (isUniqueConstraintViolation(error)) {
        return prisma.cashDailyBalance.findFirstOrThrow();
      }
      throw error;
    }

    await this.writeAuditLog({
      actorUserId,
      action: "cash_daily_balance.seeded",
      entityType: "CashDailyBalance",
      entityId: balance.id,
      newValues: balance,
    });

    return balance;
  }

  // Materializes a date's record on demand, carrying startingBalanceCents
  // forward from the most recent CONFIRMED day — never re-entered
  // manually, and never silently defaulted to 0. Returns null (not a
  // thrown error) when no prior CONFIRMED day exists at all, so the
  // caller/UI can offer the one-time seed flow instead.
  async getOrCreateBalanceForDate(date: Date): Promise<CashDailyBalance | null> {
    const targetDate = toMidnight(date);
    const existing = await prisma.cashDailyBalance.findUnique({ where: { date: targetDate } });
    if (existing) {
      return existing;
    }

    // Real incident (2026-08-07) — see PriorDayNotClosedError's own
    // comment. Scoped to the SPECIFIC immediately-preceding calendar
    // day, not "any earlier OPEN day" — a genuine gap (no record at all
    // for the day before) is a different, pre-existing situation this
    // isn't meant to block; only an actual unconfirmed row sitting
    // there is.
    const previousDate = new Date(targetDate);
    previousDate.setDate(previousDate.getDate() - 1);
    const previousDay = await prisma.cashDailyBalance.findUnique({ where: { date: previousDate } });
    if (previousDay && previousDay.status !== "CONFIRMED") {
      throw new PriorDayNotClosedError(previousDate);
    }

    const mostRecentConfirmed = await prisma.cashDailyBalance.findFirst({
      where: { status: "CONFIRMED", date: { lt: targetDate } },
      orderBy: { date: "desc" },
    });
    if (!mostRecentConfirmed || mostRecentConfirmed.confirmedEndingBalanceCents === null) {
      return null;
    }

    // Only what stayed in the drawer carries forward — the bulk of each
    // day's cash gets pulled for the bank/safe at close (withdrawnCents),
    // never the full confirmed count. See the schema field's own comment.
    const carriedForwardCents =
      mostRecentConfirmed.confirmedEndingBalanceCents - mostRecentConfirmed.withdrawnCents;

    try {
      return await prisma.cashDailyBalance.create({
        data: {
          date: targetDate,
          startingBalanceCents: carriedForwardCents,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return prisma.cashDailyBalance.findUniqueOrThrow({ where: { date: targetDate } });
      }
      throw error;
    }
  }

  // Live — startingBalanceCents + Cash sales for that same day, as of
  // right now. Shown to staff BEFORE they confirm, same "expected"
  // pattern GCash reconciliation and shift cash reconciliation both
  // already established.
  async getExpectedEndingBalance(
    balance: Pick<CashDailyBalance, "date" | "startingBalanceCents">,
  ): Promise<number> {
    const cashSalesCents = await saleService.getCashSalesForDate(balance.date);
    return balance.startingBalanceCents + cashSalesCents;
  }

  // varianceCents is computed and written on confirm — same "written
  // once, at close" shape as Shift.varianceCents and GcashDailyBalance's
  // own confirmBalance. A note is required only when the variance is
  // non-zero — enforced here (the only place the variance is known),
  // not at the schema layer.
  async confirmBalance(
    date: Date,
    confirmedEndingBalanceCents: number,
    withdrawnCents: number,
    notes: string | undefined,
    employeeId: string,
    actorUserId: string,
  ): Promise<CashDailyBalance> {
    const targetDate = toMidnight(date);
    const existing = await prisma.cashDailyBalance.findUnique({ where: { date: targetDate } });
    if (!existing) {
      throw new Error("No cash balance record exists for this date yet.");
    }
    if (existing.status !== "OPEN") {
      throw new CashBalanceAlreadyConfirmedError();
    }
    if (withdrawnCents < 0 || withdrawnCents > confirmedEndingBalanceCents) {
      throw new Error("Cash withdrawn can't be negative or more than the confirmed drawer count.");
    }

    // Real incident (2026-08-07) — GCash's twin guard, same reasoning:
    // confirming a later day while an earlier one is still OPEN let a
    // wrong, stale starting balance slip through silently. Closing days
    // out of order is common here (a shift can run past midnight), so
    // this is refused outright rather than trusted to staff discipline.
    const earlierOpenDay = await prisma.cashDailyBalance.findFirst({
      where: { date: { lt: targetDate }, status: "OPEN" },
      orderBy: { date: "asc" },
    });
    if (earlierOpenDay) {
      throw new Error(
        `${earlierOpenDay.date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })} is still open — close it first before confirming a later day.`,
      );
    }

    const expectedEndingBalanceCents = await this.getExpectedEndingBalance(existing);
    const varianceCents = confirmedEndingBalanceCents - expectedEndingBalanceCents;

    if (varianceCents !== 0 && !notes?.trim()) {
      throw new Error(
        `Confirmed balance doesn't match the expected amount (${varianceCents > 0 ? "+" : ""}${(varianceCents / 100).toFixed(2)} PHP). Enter a note explaining the difference before confirming.`,
      );
    }

    const balance = await prisma.cashDailyBalance.update({
      where: { id: existing.id },
      data: {
        status: "CONFIRMED",
        expectedEndingBalanceCents,
        confirmedEndingBalanceCents,
        withdrawnCents,
        varianceCents,
        notes,
        confirmedByEmployeeId: employeeId,
        confirmedAt: new Date(),
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "cash_daily_balance.confirmed",
      entityType: "CashDailyBalance",
      entityId: balance.id,
      oldValues: existing,
      newValues: balance,
    });

    return balance;
  }

  // Only while OPEN — a CONFIRMED day's numbers are the historical
  // record, not editable through this path. Audit-logged with the old
  // value, new value, and reason together, so "who/when/why" is always
  // answerable later.
  async overrideStartingBalance(
    date: Date,
    newStartingBalanceCents: number,
    reason: string,
    actorUserId: string,
  ): Promise<CashDailyBalance> {
    if (!reason.trim()) {
      throw new Error("A reason is required to override the starting balance.");
    }

    const targetDate = toMidnight(date);
    const existing = await prisma.cashDailyBalance.findUnique({ where: { date: targetDate } });
    if (!existing) {
      throw new Error("No cash balance record exists for this date yet.");
    }
    if (existing.status !== "OPEN") {
      throw new CashBalanceAlreadyConfirmedError();
    }

    const oldStartingBalanceCents = existing.startingBalanceCents;
    const balance = await prisma.cashDailyBalance.update({
      where: { id: existing.id },
      data: { startingBalanceCents: newStartingBalanceCents },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "cash_daily_balance.starting_balance_overridden",
      entityType: "CashDailyBalance",
      entityId: balance.id,
      oldValues: { startingBalanceCents: oldStartingBalanceCents },
      newValues: { startingBalanceCents: newStartingBalanceCents, reason },
    });

    return balance;
  }

  // "There's no option to close it" (reported live, 2026-08-04) — same
  // undo as GcashReconciliationService.reopenBalance, see that method's
  // own comment. Only from CONFIRMED; wipes confirm-time fields
  // (including withdrawnCents) back to pre-confirm state, but the audit
  // log (oldValues below) keeps the original close permanently
  // recoverable.
  async reopenBalance(date: Date, reason: string, actorUserId: string): Promise<CashDailyBalance> {
    if (!reason.trim()) {
      throw new Error("A reason is required to reopen this day.");
    }

    const targetDate = toMidnight(date);
    const existing = await prisma.cashDailyBalance.findUnique({ where: { date: targetDate } });
    if (!existing) {
      throw new Error("No cash balance record exists for this date yet.");
    }
    if (existing.status !== "CONFIRMED") {
      throw new Error("This day isn't confirmed — nothing to reopen.");
    }

    const balance = await prisma.cashDailyBalance.update({
      where: { id: existing.id },
      data: {
        status: "OPEN",
        expectedEndingBalanceCents: null,
        confirmedEndingBalanceCents: null,
        withdrawnCents: 0,
        varianceCents: null,
        notes: null,
        confirmedByEmployeeId: null,
        confirmedAt: null,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "cash_daily_balance.reopened",
      entityType: "CashDailyBalance",
      entityId: balance.id,
      oldValues: { ...existing, reason },
      newValues: balance,
    });

    return balance;
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

export const cashReconciliationService = new CashReconciliationService();
