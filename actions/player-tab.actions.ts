"use server";

import { revalidatePath } from "next/cache";

import {
  addAdjustmentInputSchema,
  addRentalLineItemInputSchema,
  closeSessionInputSchema,
  settleTabInputSchema,
  voidLineItemInputSchema,
  writeOffTabInputSchema,
  type AddAdjustmentInput,
  type AddRentalLineItemInput,
  type CloseSessionInput,
  type SettleTabInput,
  type VoidLineItemInput,
  type WriteOffTabInput,
} from "@/features/open-play-capacity/schemas/player-tab.schema";
import { requireEmployee, requireEmployeeWithOpenShift, requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { openPlayCapacityService } from "@/services/open-play/open-play-capacity.service";
import { playerTabService } from "@/services/open-play/player-tab.service";
import { PERMISSIONS } from "@/types/permissions";

export interface PlayerTabActionState {
  error: string | null;
}

function requireOpenPlayManage() {
  return requirePermission(PERMISSIONS.OPEN_PLAY_MANAGE, "You don't have permission to manage open play.");
}

function revalidateOpenPlayCapacity(): void {
  revalidatePath("/dashboard/admin/open-play-capacity");
  revalidatePath("/dashboard/sales");
}

// Settlement is revenue-producing — needs an Employee + currently open
// Shift, same as every other Sale-creating action in this app (booking,
// equipment/locker rental, membership, tournament).
export async function settleTabAction(input: SettleTabInput): Promise<PlayerTabActionState> {
  const authz = await requireEmployeeWithOpenShift(
    PERMISSIONS.OPEN_PLAY_MANAGE,
    "You don't have permission to settle open play tabs.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = settleTabInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await playerTabService.settleTab(
      parsed.data.tabId,
      parsed.data.method,
      parsed.data.gcashReference ?? null,
      { employeeId: authz.employeeId, shiftId: authz.shiftId, paymentMethodId: parsed.data.paymentMethodId },
      authz.userId,
    );
    revalidateOpenPlayCapacity();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "settleTabAction", userId: authz.userId }) };
  }
}

export async function addRentalLineItemAction(input: AddRentalLineItemInput): Promise<PlayerTabActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = addRentalLineItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await playerTabService.addRentalLineItem(
      parsed.data.tabId,
      parsed.data.equipmentKey,
      parsed.data.description,
      parsed.data.qty,
      authz.userId,
    );
    revalidateOpenPlayCapacity();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "addRentalLineItemAction", userId: authz.userId }) };
  }
}

export async function addAdjustmentAction(input: AddAdjustmentInput): Promise<PlayerTabActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = addAdjustmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await playerTabService.addAdjustment(
      parsed.data.tabId,
      parsed.data.description,
      parsed.data.amountCents,
      parsed.data.reason,
      authz.userId,
    );
    revalidateOpenPlayCapacity();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "addAdjustmentAction", userId: authz.userId }) };
  }
}

export async function voidLineItemAction(input: VoidLineItemInput): Promise<PlayerTabActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = voidLineItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await playerTabService.voidLineItem(parsed.data.tabId, parsed.data.lineItemId, parsed.data.reason, authz.userId);
    revalidateOpenPlayCapacity();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "voidLineItemAction", userId: authz.userId }) };
  }
}

export async function writeOffTabAction(input: WriteOffTabInput): Promise<PlayerTabActionState> {
  const authz = await requireEmployee(
    PERMISSIONS.OPEN_PLAY_MANAGE,
    "You don't have permission to write off open play tabs.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = writeOffTabInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await playerTabService.writeOffTab(parsed.data.tabId, parsed.data.reason, authz.employeeId, authz.userId);
    revalidateOpenPlayCapacity();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "writeOffTabAction", userId: authz.userId }) };
  }
}

export async function closeSessionAction(input: CloseSessionInput): Promise<PlayerTabActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = closeSessionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayCapacityService.closeSession(parsed.data.sessionId, authz.userId);
    revalidateOpenPlayCapacity();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "closeSessionAction", userId: authz.userId }) };
  }
}
