"use server";

import { revalidatePath } from "next/cache";

import {
  confirmCashBalanceSchema,
  overrideCashStartingBalanceSchema,
  seedCashBalanceSchema,
  type ConfirmCashBalanceInput,
  type OverrideCashStartingBalanceInput,
  type SeedCashBalanceInput,
} from "@/features/cash/schemas/cash-reconciliation.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { cashReconciliationService } from "@/services/cash/cash-reconciliation.service";
import { PERMISSIONS } from "@/types/permissions";

export interface CashReconciliationActionState {
  error: string | null;
}

// Cash's twin of requireGcashReconciliationEmployee — its own
// permission (an owner may want to hand cash-drawer trust to a
// different set of people than GCash trust), same "seed/confirm/
// override all share one permission" shape.
async function requireCashReconciliationEmployee() {
  const authz = await requirePermission(
    PERMISSIONS.ACCOUNTS_CONFIRM_CASH_RECONCILIATION,
    "You don't have permission to manage cash reconciliation.",
  );
  if (!authz.ok) {
    return authz;
  }

  const employee = await prisma.employee.findUnique({ where: { userId: authz.userId } });
  if (!employee) {
    return { ok: false as const, error: "No employee profile is linked to this account." };
  }

  return { ok: true as const, userId: authz.userId, employeeId: employee.id };
}

function revalidateCashReconciliation(): void {
  revalidatePath("/dashboard/admin/gcash-reconciliation");
}

export async function seedCashBalanceAction(
  input: SeedCashBalanceInput,
): Promise<CashReconciliationActionState> {
  const authz = await requireCashReconciliationEmployee();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = seedCashBalanceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid amount." };
  }

  try {
    await cashReconciliationService.seedFirstBalance(
      parsed.data.startingBalanceCents,
      authz.userId,
    );
    revalidateCashReconciliation();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "seedCashBalanceAction", userId: authz.userId }),
    };
  }
}

export async function confirmCashBalanceAction(
  input: ConfirmCashBalanceInput,
): Promise<CashReconciliationActionState> {
  const authz = await requireCashReconciliationEmployee();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = confirmCashBalanceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid confirmation details." };
  }

  try {
    await cashReconciliationService.confirmBalance(
      new Date(`${parsed.data.date}T00:00:00`),
      parsed.data.confirmedEndingBalanceCents,
      parsed.data.withdrawnCents,
      parsed.data.notes,
      authz.employeeId,
      authz.userId,
    );
    revalidateCashReconciliation();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "confirmCashBalanceAction", userId: authz.userId }),
    };
  }
}

export async function overrideCashStartingBalanceAction(
  input: OverrideCashStartingBalanceInput,
): Promise<CashReconciliationActionState> {
  const authz = await requireCashReconciliationEmployee();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = overrideCashStartingBalanceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid correction." };
  }

  try {
    await cashReconciliationService.overrideStartingBalance(
      new Date(`${parsed.data.date}T00:00:00`),
      parsed.data.newStartingBalanceCents,
      parsed.data.reason,
      authz.userId,
    );
    revalidateCashReconciliation();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "overrideCashStartingBalanceAction",
        userId: authz.userId,
      }),
    };
  }
}
