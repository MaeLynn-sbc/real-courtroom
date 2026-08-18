import { computeBusinessDate, isWithinBusinessDay } from "@/lib/business-date";
import type { GcashDailyBalance, Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { expenseService } from "@/services/expenses/expense.service";
import { saleService } from "@/services/sales/sale.service";
import { settingsService } from "@/services/settings/settings.service";

// GCash reconciliation Gate 1 (BUILD-SPEC.md-adjacent — same discipline
// as shift cash reconciliation, built on the same proven pattern).
// Date-scoped, not shift-scoped: GCash is one shared account balance
// for the whole business, unlike a physical cash drawer handed off
// per shift, so every shift on a given calendar day feeds the SAME
// day's record.
//
// The formula (BUILD-SPEC's own framing): starting balance + today's
// GCash sales − today's GCash-paid write-offs/refunds/expenses =
// expected ending balance. Owner request (2026-08-07): expenses paid
// via GCash now subtract via expenseService.getGcashExpensesForDate,
// see that method's own comment. The refund/write-off terms remain
// structurally absent, still confirmed by reading the actual code:
// BookingRefund has no paymentMethodId at all (refunds aren't
// attributed to a payment method), and it's never even created anywhere
// in this codebase today (zero non-schema references — the model is
// dormant plumbing). A PlayerTab write-off, by construction, creates no
// Sale row at all ("No Sale row is created, so this can never count as
// revenue" — its own existing comment) — nothing was ever collected via
// any payment method for a written-off amount, so there is nothing to
// subtract from GCash specifically for either of those two. If
// BookingRefund is ever wired up with payment-method attribution in the
// future, this formula would need to incorporate it then — flagged
// here, not silently ignored.

// Owner-directed consolidation (2026-08-12): deliberately NOT replaced
// with computeBusinessDate everywhere — every call below except
// seedFirstBalance's normalizes a date the CALLER already decided
// (the page's own ?date= param, itself now resolved via
// computeBusinessDate when omitted — see that page's own comment).
// Re-running rollover logic on an already-resolved business date would
// be wrong, not extra-safe; this just strips the time-of-day off a
// value that's already correct.
function toMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002"
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

export class GcashBalanceAlreadyConfirmedError extends Error {
  constructor() {
    super("This day's GCash balance is already confirmed.");
    this.name = "GcashBalanceAlreadyConfirmedError";
  }
}

// Real incident (2026-08-07): getOrCreateBalanceForDate used to skip
// PAST an unconfirmed (OPEN) day to find an older CONFIRMED one instead
// — so a later day could silently materialize with a stale starting
// balance instead of surfacing that the immediately preceding day needs
// to close first. Thrown, not returned as null — null already means
// something different ("no CONFIRMED history at all yet, offer the
// one-time seed flow"); this is a distinct, real obstacle with a
// specific date attached, not an empty-history state.
export class PriorDayNotClosedError extends Error {
  constructor(public readonly priorDate: Date) {
    super(
      `${priorDate.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })} must be closed first.`,
    );
    this.name = "PriorDayNotClosedError";
  }
}

export class GcashReconciliationService {
  async getBalanceForDate(date: Date): Promise<GcashDailyBalance | null> {
    return prisma.gcashDailyBalance.findUnique({ where: { date: toMidnight(date) } });
  }

  async listRecentBalances(limit = 14) {
    return prisma.gcashDailyBalance.findMany({
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
    rolloverHour = 0,
  ): Promise<GcashDailyBalance> {
    const anyExisting = await prisma.gcashDailyBalance.findFirst();
    if (anyExisting) {
      throw new Error("GCash reconciliation has already been started — the starting balance can't be re-seeded.");
    }

    let balance: GcashDailyBalance;
    try {
      balance = await prisma.gcashDailyBalance.create({
        // Owner-directed consolidation (2026-08-12): the one real
        // "what day is it right now" spot in this file — rollover-hour
        // aware, not literal calendar midnight.
        data: { date: computeBusinessDate(new Date(), rolloverHour), startingBalanceCents },
      });
    } catch (error) {
      // Same benign-race handling as getOrCreateSessionForDate — two
      // concurrent first-time seed attempts both see "no existing row"
      // before either commits; the loser collides on the real unique
      // constraint instead of erroring.
      if (isUniqueConstraintViolation(error)) {
        return prisma.gcashDailyBalance.findFirstOrThrow();
      }
      throw error;
    }

    await this.writeAuditLog({
      actorUserId,
      action: "gcash_daily_balance.seeded",
      entityType: "GcashDailyBalance",
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
  async getOrCreateBalanceForDate(date: Date): Promise<GcashDailyBalance | null> {
    const targetDate = toMidnight(date);
    const existing = await prisma.gcashDailyBalance.findUnique({ where: { date: targetDate } });
    if (existing) {
      return existing;
    }

    // Real incident (2026-08-07) — see PriorDayNotClosedError's own
    // comment. Checked BEFORE the "most recent confirmed" search below,
    // and scoped to the SPECIFIC immediately-preceding calendar day, not
    // "any earlier OPEN day" — a genuine gap (no record at all for the
    // day before, e.g. the business simply wasn't reconciled that day)
    // is a different, pre-existing situation this isn't meant to block;
    // only an actual unconfirmed row sitting there is.
    const previousDate = new Date(targetDate);
    previousDate.setDate(previousDate.getDate() - 1);
    const previousDay = await prisma.gcashDailyBalance.findUnique({ where: { date: previousDate } });
    if (previousDay && previousDay.status !== "CONFIRMED") {
      throw new PriorDayNotClosedError(previousDate);
    }

    const mostRecentConfirmed = await prisma.gcashDailyBalance.findFirst({
      where: { status: "CONFIRMED", date: { lt: targetDate } },
      orderBy: { date: "desc" },
    });
    if (!mostRecentConfirmed || mostRecentConfirmed.confirmedEndingBalanceCents === null) {
      return null;
    }

    try {
      return await prisma.gcashDailyBalance.create({
        data: { date: targetDate, startingBalanceCents: mostRecentConfirmed.confirmedEndingBalanceCents },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return prisma.gcashDailyBalance.findUniqueOrThrow({ where: { date: targetDate } });
      }
      throw error;
    }
  }

  // Hardening (2026-08-12): the one remaining spot where "what day is
  // today" was being resolved by the CALLER (the reconciliation page)
  // instead of enforced here — unlike Sale.businessDate, which is
  // computed inside createSale itself so no caller can get it wrong. A
  // future caller (a dashboard tile, an API route) fetching "today's
  // balance" by hand-rolling toMidnight(new Date()) could silently
  // reintroduce the exact midnight-rollover bug the Group B
  // consolidation just fixed. This is the enforced version — always
  // rollover-hour aware, never re-implementable wrong. The reconciliation
  // page now calls this instead of computing "today" itself.
  async getTodaysBalance(rolloverHour: number): Promise<GcashDailyBalance | null> {
    return this.getOrCreateBalanceForDate(computeBusinessDate(new Date(), rolloverHour));
  }

  // Live — startingBalanceCents + GCash sales for that same day, as of
  // right now. Shown to staff BEFORE they confirm, same "expected"
  // pattern shift cash reconciliation already established. See
  // CashReconciliationService.getExpectedEndingBalance's own comment —
  // same real incident (2026-08-08), same fix: a sale that happened
  // before the PREVIOUS day was physically confirmed was already
  // captured in that count and must not be counted again here.
  async getExpectedEndingBalance(balance: Pick<GcashDailyBalance, "date" | "startingBalanceCents">): Promise<number> {
    const previousDate = new Date(balance.date);
    previousDate.setDate(previousDate.getDate() - 1);
    const previousDay = await prisma.gcashDailyBalance.findUnique({ where: { date: previousDate } });

    // Owner decision (2026-08-18), option B. The cutoff is applied ONLY
    // when the previous day was confirmed inside its OWN business-day
    // window, using the STORED rollover hour rather than a literal 3.
    //
    // Why: this floor filters on raw createdAt while the day itself is
    // selected by businessDate — two different axes. A day confirmed LATE
    // puts that floor past the whole of this day's trading and excludes
    // every sale. Production hit exactly that: business date 2026-08-04
    // computed PHP 0.00 against PHP 4,580.00 of real cash sales because
    // 2026-08-03 was not confirmed until five days afterwards, leaving
    // staff unable to close the day at all.
    //
    // A timely close (the Aug 8 shape — a shift finishing 00:54, still
    // inside its own window) keeps its cutoff, because that timestamp
    // genuinely marks money already counted in that drawer. A confirm days
    // later says nothing about what was physically counted, so it is
    // ignored. See lib/business-date.ts's isWithinBusinessDay.
    const { businessDateRolloverHour } = await settingsService.getCourtHours();
    const rawCutoff = previousDay?.confirmedAt ?? null;
    const cutoff =
      rawCutoff && isWithinBusinessDay(rawCutoff, previousDate, businessDateRolloverHour)
        ? rawCutoff
        : undefined;

    const [gcashSalesCents, gcashExpensesCents] = await Promise.all([
      saleService.getGcashSalesForDate(balance.date, cutoff),
      expenseService.getGcashExpensesForDate(balance.date),
    ]);
    return balance.startingBalanceCents + gcashSalesCents - gcashExpensesCents;
  }

  // varianceCents is now actually computed and written on confirm —
  // same "written once, at close" shape as Shift.varianceCents. A note
  // is required only when the variance is non-zero — enforced here
  // (the only place the variance is known), not at the schema layer.
  async confirmBalance(
    date: Date,
    confirmedEndingBalanceCents: number,
    notes: string | undefined,
    employeeId: string,
    actorUserId: string,
  ): Promise<GcashDailyBalance> {
    const targetDate = toMidnight(date);
    const existing = await prisma.gcashDailyBalance.findUnique({ where: { date: targetDate } });
    if (!existing) {
      throw new Error("No GCash balance record exists for this date yet.");
    }
    if (existing.status !== "OPEN") {
      throw new GcashBalanceAlreadyConfirmedError();
    }

    // Real incident (2026-08-07): nothing here used to check any EARLIER
    // day's status — Aug 7 got confirmed while Aug 6 was still OPEN.
    // getOrCreateBalanceForDate's carry-forward looks for the most
    // recent CONFIRMED day and silently SKIPS PAST an unconfirmed one to
    // find it, so Aug 7 quietly inherited Aug 5's confirmed figure
    // instead of Aug 6's — landing on a number that happened to equal
    // Aug 6's own starting balance, not its real closing one. Closing
    // days out of order is common here (a shift can run past midnight),
    // so this is refused outright rather than trusted to staff
    // discipline — every earlier OPEN day must close first.
    const earlierOpenDay = await prisma.gcashDailyBalance.findFirst({
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

    const balance = await prisma.gcashDailyBalance.update({
      where: { id: existing.id },
      data: {
        status: "CONFIRMED",
        expectedEndingBalanceCents,
        confirmedEndingBalanceCents,
        varianceCents,
        notes,
        confirmedByEmployeeId: employeeId,
        confirmedAt: new Date(),
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "gcash_daily_balance.confirmed",
      entityType: "GcashDailyBalance",
      entityId: balance.id,
      oldValues: existing,
      newValues: balance,
    });

    return balance;
  }

  // "An authorized person CAN manually correct the starting balance...
  // only with a required reason." Only while OPEN — a CONFIRMED day's
  // numbers are the historical record, not editable through this path.
  // Audit-logged with the old value, new value, and reason together, so
  // "who/when/why" is always answerable later.
  async overrideStartingBalance(
    date: Date,
    newStartingBalanceCents: number,
    reason: string,
    actorUserId: string,
  ): Promise<GcashDailyBalance> {
    if (!reason.trim()) {
      throw new Error("A reason is required to override the starting balance.");
    }

    const targetDate = toMidnight(date);
    const existing = await prisma.gcashDailyBalance.findUnique({ where: { date: targetDate } });
    if (!existing) {
      throw new Error("No GCash balance record exists for this date yet.");
    }
    if (existing.status !== "OPEN") {
      throw new GcashBalanceAlreadyConfirmedError();
    }

    const oldStartingBalanceCents = existing.startingBalanceCents;
    const balance = await prisma.gcashDailyBalance.update({
      where: { id: existing.id },
      data: { startingBalanceCents: newStartingBalanceCents },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "gcash_daily_balance.starting_balance_overridden",
      entityType: "GcashDailyBalance",
      entityId: balance.id,
      oldValues: { startingBalanceCents: oldStartingBalanceCents },
      newValues: { startingBalanceCents: newStartingBalanceCents, reason },
    });

    return balance;
  }

  // "There's no option to close it" (reported live, 2026-08-04): a day
  // confirmed too early (staff closed at 8 AM, before most of the day's
  // real sales had even happened) has no way back to OPEN through
  // confirmBalance/overrideStartingBalance — both explicitly require
  // OPEN. This is the undo. Only from CONFIRMED (nothing to reopen from
  // OPEN); wipes the confirm-time fields back to their pre-confirm
  // state, but the audit log (oldValues below) keeps the original close
  // — including whatever real numbers were entered then — permanently
  // recoverable even after this runs.
  async reopenBalance(date: Date, reason: string, actorUserId: string): Promise<GcashDailyBalance> {
    if (!reason.trim()) {
      throw new Error("A reason is required to reopen this day.");
    }

    const targetDate = toMidnight(date);
    const existing = await prisma.gcashDailyBalance.findUnique({ where: { date: targetDate } });
    if (!existing) {
      throw new Error("No GCash balance record exists for this date yet.");
    }
    if (existing.status !== "CONFIRMED") {
      throw new Error("This day isn't confirmed — nothing to reopen.");
    }

    const balance = await prisma.gcashDailyBalance.update({
      where: { id: existing.id },
      data: {
        status: "OPEN",
        expectedEndingBalanceCents: null,
        confirmedEndingBalanceCents: null,
        varianceCents: null,
        notes: null,
        confirmedByEmployeeId: null,
        confirmedAt: null,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "gcash_daily_balance.reopened",
      entityType: "GcashDailyBalance",
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
      logger.error({ err: error, action: entry.action, userId: entry.actorUserId }, "Failed to write audit log entry");
    }
  }
}

export const gcashReconciliationService = new GcashReconciliationService();
