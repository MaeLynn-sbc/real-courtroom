import type { Expense, Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
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

// GCash reconciliation dependency (spec point 6, not built here): GCash
// reconciliation's formula (services/gcash/gcash-reconciliation.service.ts,
// on the separate feature/gcash-reconciliation-gate1 branch as of this
// writing) currently has no subtraction term, because nothing in the app
// paid via GCash was ever tracked as money leaving the business — that
// service's own top comment documents this explicitly. Expense.
// paymentMethodId changes that: once an Expense is recorded against the
// GCash PaymentMethod row, it becomes a real, queryable GCash outflow. If
// GCash reconciliation is revisited after this branch merges, its expected-
// balance formula should subtract same-day GCash-paid expenses (a
// getGcashExpensesForDate(date), mirroring saleService.getGcashSalesForDate,
// is the natural shape) — not built now, since only the dependency itself
// was in scope for this gate, per the instruction that created it.
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
        await getUploadService().delete(upload.key).catch(() => undefined);
      }
      throw error;
    }
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
