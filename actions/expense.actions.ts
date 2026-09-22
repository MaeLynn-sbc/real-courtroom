"use server";

import { revalidatePath } from "next/cache";

import {
  createExpenseSchema,
  voidExpenseSchema,
  type CreateExpenseInput,
  type VoidExpenseInput,
} from "@/features/expenses/schemas/expense.schema";
import { requireEmployee } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { expenseService } from "@/services/expenses/expense.service";
import { PERMISSIONS } from "@/types/permissions";

export interface ExpenseActionState {
  error: string | null;
}

// Owner-reported incident (2026-09-21): the same P8,200 coach payout was
// recorded twice, 15 seconds apart, on a slow connection. Nothing warned,
// and nothing could undo it. When a matching expense is already on file
// this comes back INSTEAD of writing — nothing is saved, and the caller
// shows the warning and can resubmit with confirmDuplicate.
export interface CreateExpenseActionState extends ExpenseActionState {
  duplicate?: {
    id: string;
    amountCents: number;
    description: string;
    categoryName: string;
    paymentMethodLabel: string;
    recordedBy: string;
    recordedAt: string;
  };
}

// Corrects ONLY the payment method on an existing expense. Gated on the
// same permission as recording one — someone trusted to enter an expense
// is trusted to fix which till it came out of.
export async function correctExpensePaymentMethodAction(input: {
  expenseId: string;
  paymentMethodId: string;
}): Promise<ExpenseActionState> {
  const authz = await requireEmployee(
    PERMISSIONS.ACCOUNTS_RECORD_EXPENSE,
    "You don't have permission to edit expenses.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  if (!input.expenseId || !input.paymentMethodId) {
    return { error: "Pick a payment method." };
  }

  try {
    await expenseService.updateExpensePaymentMethod(
      input.expenseId,
      input.paymentMethodId,
      authz.userId,
    );
    revalidatePath("/dashboard/admin/expenses");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "correctExpensePaymentMethodAction",
        userId: authz.userId,
      }),
    };
  }
}

export async function createExpenseAction(
  input: CreateExpenseInput,
): Promise<CreateExpenseActionState> {
  const authz = await requireEmployee(
    PERMISSIONS.ACCOUNTS_RECORD_EXPENSE,
    "You don't have permission to record expenses.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid expense details." };
  }

  const date = new Date(`${parsed.data.date}T00:00:00`);

  try {
    if (!parsed.data.confirmDuplicate) {
      const existing = await expenseService.findRecentDuplicate({
        amountCents: parsed.data.amountCents,
        date,
        categoryId: parsed.data.categoryId,
        paymentMethodId: parsed.data.paymentMethodId,
      });
      if (existing) {
        return {
          error: null,
          duplicate: {
            id: existing.id,
            amountCents: existing.amountCents,
            description: existing.description,
            categoryName: existing.category.name,
            paymentMethodLabel: existing.paymentMethod.label,
            recordedBy: `${existing.recordedByEmployee.firstName} ${existing.recordedByEmployee.lastName}`.trim(),
            recordedAt: existing.createdAt.toISOString(),
          },
        };
      }
    }

    await expenseService.createExpense(
      {
        amountCents: parsed.data.amountCents,
        date,
        description: parsed.data.description,
        categoryId: parsed.data.categoryId,
        paymentMethodId: parsed.data.paymentMethodId,
        recordedByEmployeeId: authz.employeeId,
        receipt: parsed.data.receipt
          ? {
              fileName: parsed.data.receipt.fileName,
              contentType: parsed.data.receipt.contentType,
              data: Buffer.from(parsed.data.receipt.dataBase64, "base64"),
            }
          : undefined,
      },
      authz.userId,
    );
    revalidatePath("/dashboard/admin/expenses");
    revalidatePath("/dashboard/reports");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "createExpenseAction", userId: authz.userId }) };
  }
}

// The other half of the same incident: there was no way to take a
// mistaken expense off the books at all. Voids rather than deletes — see
// expenseService.voidExpense. Same permission as recording one: someone
// trusted to enter an expense is trusted to reverse the one they just
// mis-entered, exactly as correctExpensePaymentMethodAction reasons.
export async function voidExpenseAction(input: VoidExpenseInput): Promise<ExpenseActionState> {
  const authz = await requireEmployee(
    PERMISSIONS.ACCOUNTS_RECORD_EXPENSE,
    "You don't have permission to edit expenses.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = voidExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid reversal." };
  }

  try {
    await expenseService.voidExpense(
      parsed.data.expenseId,
      parsed.data.reason,
      authz.employeeId,
      authz.userId,
    );
    revalidatePath("/dashboard/admin/expenses");
    revalidatePath("/dashboard/reports");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "voidExpenseAction", userId: authz.userId }) };
  }
}
