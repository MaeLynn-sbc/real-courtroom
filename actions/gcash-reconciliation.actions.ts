"use server";

import { revalidatePath } from "next/cache";

import {
  confirmGcashBalanceSchema,
  overrideGcashStartingBalanceSchema,
  reopenGcashBalanceSchema,
  seedGcashBalanceSchema,
  type ConfirmGcashBalanceInput,
  type OverrideGcashStartingBalanceInput,
  type ReopenGcashBalanceInput,
  type SeedGcashBalanceInput,
} from "@/features/gcash/schemas/gcash-reconciliation.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { gcashReconciliationService } from "@/services/gcash/gcash-reconciliation.service";
import { PERMISSIONS } from "@/types/permissions";

export interface GcashReconciliationActionState {
  error: string | null;
}

// GCash reconciliation Gate 1 follow-up: loosened from SYSTEM_ADMIN to
// its own dedicated, owner-assignable permission — a real checkbox on
// the roles screen, granted to nobody by default (see prisma/seed.ts's
// PERMISSION_DEFINITIONS comment). Covers seed/confirm/override alike:
// seeding is really just confirming day one, and override is already
// reason-required and audit-logged regardless of who does it, so none
// of the three warrant a narrower/separate permission from each other.
async function requireGcashReconciliationEmployee() {
  const authz = await requirePermission(
    PERMISSIONS.ACCOUNTS_CONFIRM_GCASH_RECONCILIATION,
    "You don't have permission to manage GCash reconciliation.",
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

function revalidateGcashReconciliation(): void {
  revalidatePath("/dashboard/admin/gcash-reconciliation");
}

export async function seedGcashBalanceAction(input: SeedGcashBalanceInput): Promise<GcashReconciliationActionState> {
  const authz = await requireGcashReconciliationEmployee();
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
  const authz = await requireGcashReconciliationEmployee();
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
  const authz = await requireGcashReconciliationEmployee();
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

export async function reopenGcashBalanceAction(
  input: ReopenGcashBalanceInput,
): Promise<GcashReconciliationActionState> {
  const authz = await requireGcashReconciliationEmployee();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = reopenGcashBalanceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await gcashReconciliationService.reopenBalance(
      new Date(`${parsed.data.date}T00:00:00`),
      parsed.data.reason,
      authz.userId,
    );
    revalidateGcashReconciliation();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "reopenGcashBalanceAction", userId: authz.userId }) };
  }
}
