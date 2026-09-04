"use server";

import { revalidatePath } from "next/cache";

import { createExpenseSchema, type CreateExpenseInput } from "@/features/expenses/schemas/expense.schema";
import { requireEmployee } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { expenseService } from "@/services/expenses/expense.service";
import { PERMISSIONS } from "@/types/permissions";

export interface ExpenseActionState {
  error: string | null;
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

export async function createExpenseAction(input: CreateExpenseInput): Promise<ExpenseActionState> {
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

  try {
    await expenseService.createExpense(
      {
        amountCents: parsed.data.amountCents,
        date: new Date(`${parsed.data.date}T00:00:00`),
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
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "createExpenseAction", userId: authz.userId }) };
  }
}
