"use server";

import { revalidatePath } from "next/cache";

import {
  confirmGcashBalanceSchema,
  overrideGcashStartingBalanceSchema,
  seedGcashBalanceSchema,
  type ConfirmGcashBalanceInput,
  type OverrideGcashStartingBalanceInput,
  type SeedGcashBalanceInput,
} from "@/features/gcash/schemas/gcash-reconciliation.schema";
import { requireSystemAdmin } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { gcashReconciliationService } from "@/services/gcash/gcash-reconciliation.service";

export interface GcashReconciliationActionState {
  error: string | null;
}

// GCash reconciliation is a shared, whole-business balance, not a
// per-employee drawer the way shift cash is — confirming or correcting
// it is owner-tier, not self-service. No narrower "accounts" permission
// exists yet (confirmed by direct investigation before this gate was
// built) — gating on SYSTEM_ADMIN is the same conservative choice this
// codebase already makes for other owner-only financial-adjacent
// settings (e.g. coaching rate-table edits). Revisit if a dedicated
// permission is ever wanted.
async function requireSystemAdminEmployee() {
  const authz = await requireSystemAdmin("You don't have permission to manage GCash reconciliation.");
  if (!authz.ok) {
    return authz;
  }

  const employee = await prisma.employee.findUnique({ where: { userId: authz.userId } });
  if (!employee) {
    return { ok: false as const, error: "No employee profile is linked to this account." };
  }

  return { ok: true as const, userId: authz.userId, employeeId: employee.id };
}

function revalidateGcashReconciliation(): void {
  revalidatePath("/dashboard/admin/gcash-reconciliation");
}

export async function seedGcashBalanceAction(input: SeedGcashBalanceInput): Promise<GcashReconciliationActionState> {
  const authz = await requireSystemAdminEmployee();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = seedGcashBalanceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid amount." };
  }

  try {
    await gcashReconciliationService.seedFirstBalance(parsed.data.startingBalanceCents, authz.userId);
    revalidateGcashReconciliation();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "seedGcashBalanceAction", userId: authz.userId }) };
  }
}

export async function confirmGcashBalanceAction(input: ConfirmGcashBalanceInput): Promise<GcashReconciliationActionState> {
  const authz = await requireSystemAdminEmployee();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = confirmGcashBalanceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid confirmation details." };
  }

  try {
    await gcashReconciliationService.confirmBalance(
      new Date(`${parsed.data.date}T00:00:00`),
      parsed.data.confirmedEndingBalanceCents,
      parsed.data.notes,
      authz.employeeId,
      authz.userId,
    );
    revalidateGcashReconciliation();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "confirmGcashBalanceAction", userId: authz.userId }) };
  }
}

export async function overrideGcashStartingBalanceAction(
  input: OverrideGcashStartingBalanceInput,
): Promise<GcashReconciliationActionState> {
  const authz = await requireSystemAdminEmployee();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = overrideGcashStartingBalanceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid correction." };
  }

  try {
    await gcashReconciliationService.overrideStartingBalance(
      new Date(`${parsed.data.date}T00:00:00`),
      parsed.data.newStartingBalanceCents,
      parsed.data.reason,
      authz.userId,
    );
    revalidateGcashReconciliation();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "overrideGcashStartingBalanceAction", userId: authz.userId }) };
  }
}
