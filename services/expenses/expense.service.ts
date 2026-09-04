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

export type ExpenseWithRelations = Expense & {
  category: { name: string };
  paymentMethod: { label: string };
  recordedByEmployee: { firstName: string; lastName: string };
};

// GCash reconciliation dependency (spec point 6): Expense.paymentMethodId
// makes an expense a real, queryable outflow per payment method —
// getGcashExpensesForDate/getCashExpensesForDate below are read by
// GcashReconciliationService/CashReconciliationService's own
// getExpectedEndingBalance, so a same-day expense against the matching
// payment method now actually reduces the expected balance instead of
// only ever showing up as an unexplained variance note.
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

  async listRecentExpenses(limit = 50): Promise<ExpenseWithRelations[]> {
    return prisma.expense.findMany({
      include: {
        category: { select: { name: true } },
        paymentMethod: { select: { label: true } },
        recordedByEmployee: { select: { firstName: true, lastName: true } },
      },
      orderBy: { date: "desc" },
      take: limit,
    });
  }

  // For the Reports page's summary card — total money out for the range,
  // by Expense.date (the business date it applies to), same field
  // listRecentExpenses sorts by, not createdAt.
  async getExpensesTotalForRange(range: DateRange): Promise<number> {
    const result = await prisma.expense.aggregate({
      where: { date: { gte: range.from, lte: range.to } },
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
      where: { paymentMethodId: gcashMethod.id, date },
      _sum: { amountCents: true },
    });
    return result._sum.amountCents ?? 0;
  }

  // Cash's twin of getGcashExpensesForDate above.
  async getCashExpensesForDate(date: Date): Promise<number> {
    const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

    const result = await prisma.expense.aggregate({
      where: { paymentMethodId: cashMethod.id, date },
      _sum: { amountCents: true },
    });
    return result._sum.amountCents ?? 0;
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
