"use server";

import { revalidatePath } from "next/cache";

import {
  createExpenseCategorySchema,
  updateExpenseCategorySchema,
  type CreateExpenseCategoryInput,
  type UpdateExpenseCategoryInput,
} from "@/features/expenses/schemas/expense-category.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { expenseCategoryService } from "@/services/expenses/expense-category.service";
import { PERMISSIONS } from "@/types/permissions";

export interface ExpenseCategoryActionState {
  error: string | null;
}

function requireExpensesEmployee() {
  return requirePermission(PERMISSIONS.ACCOUNTS_RECORD_EXPENSE, "You don't have permission to manage expense categories.");
}

export async function createExpenseCategoryAction(
  input: CreateExpenseCategoryInput,
): Promise<ExpenseCategoryActionState> {
  const authz = await requireExpensesEmployee();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createExpenseCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid category details." };
  }

  try {
    await expenseCategoryService.createCategory(parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/expenses");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "createExpenseCategoryAction", userId: authz.userId }) };
  }
}

export async function updateExpenseCategoryAction(
  categoryId: string,
  input: UpdateExpenseCategoryInput,
): Promise<ExpenseCategoryActionState> {
  const authz = await requireExpensesEmployee();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateExpenseCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid category details." };
  }

  try {
    await expenseCategoryService.updateCategory(categoryId, parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/expenses");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "updateExpenseCategoryAction", userId: authz.userId }) };
  }
}

export async function setExpenseCategoryActiveAction(
  categoryId: string,
  isActive: boolean,
): Promise<ExpenseCategoryActionState> {
  const authz = await requireExpensesEmployee();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await expenseCategoryService.setCategoryActive(categoryId, isActive, authz.userId);
    revalidatePath("/dashboard/admin/expenses");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setExpenseCategoryActiveAction", userId: authz.userId }) };
  }
}
