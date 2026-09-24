import type { Expense, Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
import type { DateRange } from "@/services/analytics/date-range";
import { formatExpenseNumber } from "@/services/expenses/expense-number";
import { getUploadService } from "@/services/upload/upload-service.factory";

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

interface ReceiptInput {
  fileName: string;
  contentType: string;
  data: Buffer;
}

export interface CreateExpenseInput {
  amountCents: number;
  date: Date;
  description: string;
  categoryId: string;
  paymentMethodId: string;
  recordedByEmployeeId: string;
  receipt?: ReceiptInput;
}

// How far back findRecentDuplicate looks. Long enough to catch the real
// shape of the mistake — a slow submit, an uncertain pause, a second tap
// (the reported pair was 15 seconds apart) — and to cover someone
// re-entering it minutes later after the first attempt seemed to fail.
// It only ever produces a WARNING naming the existing expense, never a
// block, so erring long costs a confirmation click; erring short costs
// the venue real money. Deliberately not all day: two coaches genuinely
// do get paid the same amount on the same evening.
const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;

export type ExpenseWithRelations = Expense & {
  category: { name: string };
  paymentMethod: { label: string };
  recordedByEmployee: { firstName: string; lastName: string };
  voidedByEmployee: { firstName: string; lastName: string } | null;
};

// GCash reconciliation dependency (spec point 6): Expense.paymentMethodId
// makes an expense a real, queryable outflow per payment method —
// getGcashExpensesForDate/getCashExpensesForDate below are read by
// GcashReconciliationService/CashReconciliationService's own
// getExpectedEndingBalance, so a same-day expense against the matching
// payment method now actually reduces the expected balance instead of
// only ever showing up as an unexplained variance note.
// One row per expense. paymentMethodKey is carried alongside the label so
// a consumer can split cash from GCash on the STABLE key rather than on
// display text, which is editable.
export interface ExpenseReportRow {
  date: Date;
  /** When it was keyed in — `date` itself is date-only. */
  recordedAt: Date;
  expenseNumber: string;
  description: string;
  category: string;
  paymentMethodKey: string;
  paymentMethodLabel: string;
  amountCents: number;
  recordedBy: string;
  isVoided: boolean;
  voidReason: string | null;
  voidedBy: string | null;
  hasReceipt: boolean;
}

export class ExpenseService {
  // Receipt is optional, but when present the upload-then-write-then-
  // cleanup-on-failure shape mirrors bookingPaymentProofService's own
  // submitBookingPaymentProof exactly — the file lands in storage first
  // (so its key exists for the DB write), and is deleted if the DB write
  // never lands, so a failed submission never leaves an orphaned file.
  async createExpense(input: CreateExpenseInput, actorUserId: string): Promise<Expense> {
    const upload = input.receipt
      ? await getUploadService().uploadPrivate({
          fileName: input.receipt.fileName,
          contentType: input.receipt.contentType,
          data: input.receipt.data,
        })
      : null;

    try {
      const sequence = await nextSequence(dailyScope("EXP", input.date));
      const expenseNumber = formatExpenseNumber(input.date, sequence);

      const expense = await prisma.expense.create({
        data: {
          expenseNumber,
          amountCents: input.amountCents,
          date: input.date,
          description: input.description,
          categoryId: input.categoryId,
          paymentMethodId: input.paymentMethodId,
          recordedByEmployeeId: input.recordedByEmployeeId,
          receiptStorageKey: upload?.key,
        },
      });

      await this.writeAuditLog({
        actorUserId,
        action: "expense.created",
        entityType: "Expense",
        entityId: expense.id,
        newValues: expense,
      });

      return expense;
    } catch (error) {
      if (upload) {
        await getUploadService()
          .delete(upload.key)
          .catch(() => undefined);
      }
      throw error;
    }
  }

  // Correct the payment method on an already-recorded expense (owner
  // request, 2026-09-04): "instead of cash we used gcash".
  //
  // ONLY the payment method. Amount, date, category and description are
  // deliberately not editable here — those are separate corrections with
  // their own consequences, and this exists to fix the one field that
  // was actually being got wrong.
  //
  // ⚠ THIS MOVES MONEY BETWEEN TWO TILLS. Cash and GCash expected
  // balances each subtract their own expenses
  // (cash-reconciliation.service.ts:251 and its GCash twin), so
  // switching cash -> GCash raises the cash expected balance and lowers
  // the GCash one by the same amount.
  //
  // A day that is already CONFIRMED keeps its stored variance. That is
  // deliberate, and matches how AttendanceRecord corrections work: the
  // closed day is a historical record of what was known when it was
  // closed, and silently rewriting it would make the reconciliation
  // report disagree with the figures staff actually signed off. The
  // audit log carries who changed it and from what, so the correction
  // is traceable without falsifying the close.
  async updateExpensePaymentMethod(
    expenseId: string,
    paymentMethodId: string,
    actorUserId: string,
  ): Promise<Expense> {
    const existing = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });

    if (existing.paymentMethodId === paymentMethodId) {
      return existing;
    }

    const expense = await prisma.expense.update({
      where: { id: expenseId },
      data: { paymentMethodId },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "expense.payment_method_corrected",
      entityType: "Expense",
      entityId: expense.id,
      oldValues: { paymentMethodId: existing.paymentMethodId },
      newValues: { paymentMethodId: expense.paymentMethodId },
    });

    return expense;
  }

  // Voided expenses stay in this list, marked, rather than disappearing:
  // "where did that P8,200 go" has to be answerable from the screen, not
  // only from the audit log. Every TOTAL above excludes them.
  async listRecentExpenses(limit = 50): Promise<ExpenseWithRelations[]> {
    return prisma.expense.findMany({
      include: {
        category: { select: { name: true } },
        paymentMethod: { select: { label: true } },
        recordedByEmployee: { select: { firstName: true, lastName: true } },
        voidedByEmployee: { select: { firstName: true, lastName: true } },
      },
      orderBy: { date: "desc" },
      take: limit,
    });
  }

  // For the Reports page's summary card — total money out for the range,
  // by Expense.date (the business date it applies to), same field
  // listRecentExpenses sorts by, not createdAt.
  // Detailed expense report (owner request, 2026-09-22): every expense in
  // a range, with its payment method, description and time.
  //
  // TWO DIFFERENT TIMESTAMPS, and the difference matters. `date` is the
  // day the money was spent and is DATE-ONLY — the entry form stores it
  // as T00:00:00 — so it carries no time at all. `createdAt` is the
  // moment the expense was keyed in. The report shows the date from
  // `date` and the time from `createdAt`, labelled "Recorded at", rather
  // than inventing a spend time that was never captured.
  //
  // VOIDED expenses are INCLUDED, flagged, and excluded from the totals.
  // Leaving them out would make a reversed duplicate vanish with no
  // trace, which is exactly the case someone reads this report to
  // understand; getExpensesTotalForRange already filters voidedAt: null,
  // and the Amount column here stays consistent with it.
  async getExpensesReport(range: DateRange): Promise<ExpenseReportRow[]> {
    const rows = await prisma.expense.findMany({
      where: { date: { gte: range.from, lte: range.to } },
      include: {
        category: { select: { name: true } },
        paymentMethod: { select: { key: true, label: true } },
        recordedByEmployee: { select: { firstName: true, lastName: true } },
        voidedByEmployee: { select: { firstName: true, lastName: true } },
      },
      // Chronological within the range, then by when it was keyed in, so
      // a day's entries read in the order they actually happened.
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });

    return rows.map((row) => ({
      date: row.date,
      recordedAt: row.createdAt,
      expenseNumber: row.expenseNumber,
      description: row.description,
      category: row.category.name,
      paymentMethodKey: row.paymentMethod.key,
      paymentMethodLabel: row.paymentMethod.label,
      amountCents: row.amountCents,
      recordedBy: `${row.recordedByEmployee.firstName} ${row.recordedByEmployee.lastName}`,
      isVoided: row.voidedAt !== null,
      voidReason: row.voidReason,
      voidedBy: row.voidedByEmployee
        ? `${row.voidedByEmployee.firstName} ${row.voidedByEmployee.lastName}`
        : null,
      hasReceipt: row.receiptStorageKey !== null,
    }));
  }

  async getExpensesTotalForRange(range: DateRange): Promise<number> {
    const result = await prisma.expense.aggregate({
      where: { date: { gte: range.from, lte: range.to }, voidedAt: null },
      _sum: { amountCents: true },
    });
    return result._sum.amountCents ?? 0;
  }

  // The dependency this file's own top comment flagged, now wired up:
  // same date-scoped shape as saleService.getGcashSalesForDate/
  // getCashSalesForDate, but for money OUT instead of in — subtracted
  // from each reconciliation's expected ending balance so a real expense
  // (rent, supplies, a bank fee paid from the drawer) explains a deficit
  // instead of just being an unexplained variance note. Filters on
  // Expense.date (the business date, local-midnight-normalized at
  // creation — actions/expense.actions.ts, always already exact
  // midnight, so an exact match is all this needs — no rollover-hour
  // math, unlike Sale.createdAt which needed the businessDate column).
  async getGcashExpensesForDate(date: Date): Promise<number> {
    const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

    const result = await prisma.expense.aggregate({
      where: { paymentMethodId: gcashMethod.id, date, voidedAt: null },
      _sum: { amountCents: true },
    });
    return result._sum.amountCents ?? 0;
  }

  // Cash's twin of getGcashExpensesForDate above.
  async getCashExpensesForDate(date: Date): Promise<number> {
    const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

    const result = await prisma.expense.aggregate({
      where: { paymentMethodId: cashMethod.id, date, voidedAt: null },
      _sum: { amountCents: true },
    });
    return result._sum.amountCents ?? 0;
  }

  // Cash paid out of the drawer while a shift was open. Expense has no
  // shiftId, so it is attributed by when it was keyed in (createdAt), not
  // by its staff-entered `date`. Owner request (2026-09-25): a shift that
  // paid ₱506 of expenses from the drawer closed as a ₱506 deficit while
  // the day's cash reconciliation — which already subtracts expenses —
  // read Balanced. The shortfall was never the attendant's.
  async getCashExpensesBetween(from: Date, to: Date): Promise<number> {
    const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

    const result = await prisma.expense.aggregate({
      where: { paymentMethodId: cashMethod.id, createdAt: { gte: from, lte: to }, voidedAt: null },
      _sum: { amountCents: true },
    });
    return result._sum.amountCents ?? 0;
  }

  // Owner-reported incident (2026-09-21): a PHP 8,200 coach payout was
  // submitted twice, 15 seconds apart, on a slow connection. The money
  // left GCash once. Nothing in this app could take the duplicate off the
  // books — there was no delete and no void for an expense at all.
  //
  // Voids, never deletes, for the same reason saleService.voidSale does:
  // the row, its receipt and its author stay, so a reconciliation can
  // still be explained months later. Reason required, employee
  // attributed — the same "no anonymous reversals" rule write-offs,
  // refunds and sale voids already follow. Idempotent by claim-check: a
  // double-submitted VOID can't fight itself either.
  async voidExpense(
    expenseId: string,
    reason: string,
    employeeId: string,
    actorUserId: string,
  ): Promise<Expense> {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      throw new Error("A reason is required to void an expense.");
    }
    if (!employeeId) {
      throw new Error("An employee must be attributed to a void.");
    }

    const existing = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });
    if (existing.voidedAt) {
      throw new Error("This expense has already been voided.");
    }

    const claim = await prisma.expense.updateMany({
      where: { id: expenseId, voidedAt: null },
      data: {
        voidedAt: new Date(),
        voidReason: trimmedReason,
        voidedByEmployeeId: employeeId,
      },
    });
    if (claim.count === 0) {
      throw new Error("This expense has already been voided — refresh and check.");
    }

    const voided = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });

    await this.writeAuditLog({
      actorUserId,
      action: "expense.voided",
      entityType: "Expense",
      entityId: expenseId,
      oldValues: { voidedAt: null, amountCents: existing.amountCents },
      newValues: {
        voidedAt: voided.voidedAt,
        voidReason: trimmedReason,
        voidedByEmployeeId: employeeId,
      },
    });

    return voided;
  }

  // The other half of the same incident: stop the duplicate being created
  // in the first place. Two expenses that match on amount, category,
  // payment method and business date, entered within this window, are
  // almost certainly one payment recorded twice — a slow connection and a
  // second tap, not two identical real outflows minutes apart. The caller
  // decides what to do with the answer; recording it anyway stays
  // possible, because the venue genuinely does pay two coaches the same
  // amount on the same day.
  async findRecentDuplicate(
    input: Pick<CreateExpenseInput, "amountCents" | "date" | "categoryId" | "paymentMethodId">,
    withinMs = DUPLICATE_WINDOW_MS,
    now: Date = new Date(),
  ): Promise<ExpenseWithRelations | null> {
    return prisma.expense.findFirst({
      where: {
        amountCents: input.amountCents,
        date: input.date,
        categoryId: input.categoryId,
        paymentMethodId: input.paymentMethodId,
        voidedAt: null,
        createdAt: { gte: new Date(now.getTime() - withinMs) },
      },
      include: {
        category: { select: { name: true } },
        paymentMethod: { select: { label: true } },
        recordedByEmployee: { select: { firstName: true, lastName: true } },
        voidedByEmployee: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
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

export const expenseService = new ExpenseService();
