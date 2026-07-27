import type { ExpenseCategory, Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

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

export interface UpsertExpenseCategoryInput {
  name: string;
  sortOrder?: number;
}

// Mirrors saleService's PaymentMethod CRUD (services/sales/sale.service.ts)
// almost exactly — ExpenseCategory is the same shape (name/isActive/
// sortOrder), minus PaymentMethod's separate `key` field, since a category
// has no other code that needs to address it by a stable string.
export class ExpenseCategoryService {
  async listCategories(includeInactive = false): Promise<ExpenseCategory[]> {
    return prisma.expenseCategory.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async createCategory(input: UpsertExpenseCategoryInput, actorUserId: string): Promise<ExpenseCategory> {
    const category = await prisma.expenseCategory.create({
      data: { name: input.name, sortOrder: input.sortOrder ?? 0 },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "expense_category.created",
      entityType: "ExpenseCategory",
      entityId: category.id,
      newValues: category,
    });

    return category;
  }

  async updateCategory(
    id: string,
    input: { name?: string; sortOrder?: number },
    actorUserId: string,
  ): Promise<ExpenseCategory> {
    const existing = await prisma.expenseCategory.findUniqueOrThrow({ where: { id } });

    const category = await prisma.expenseCategory.update({
      where: { id },
      data: { name: input.name, sortOrder: input.sortOrder },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "expense_category.updated",
      entityType: "ExpenseCategory",
      entityId: category.id,
      oldValues: existing,
      newValues: category,
    });

    return category;
  }

  async setCategoryActive(id: string, isActive: boolean, actorUserId: string): Promise<ExpenseCategory> {
    const existing = await prisma.expenseCategory.findUniqueOrThrow({ where: { id } });

    const category = await prisma.expenseCategory.update({ where: { id }, data: { isActive } });

    await this.writeAuditLog({
      actorUserId,
      action: isActive ? "expense_category.enabled" : "expense_category.disabled",
      entityType: "ExpenseCategory",
      entityId: category.id,
      oldValues: { isActive: existing.isActive },
      newValues: { isActive: category.isActive },
    });

    return category;
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

export const expenseCategoryService = new ExpenseCategoryService();
