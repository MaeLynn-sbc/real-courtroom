"use server";

import { revalidatePath } from "next/cache";

import {
  createEquipmentRentalSchema,
  createEquipmentSchema,
  logMaintenanceSchema,
  resolveMaintenanceSchema,
  updateEquipmentSchema,
  type CreateEquipmentInput,
  type CreateEquipmentRentalInput,
  type LogMaintenanceInput,
  type ResolveMaintenanceInput,
  type UpdateEquipmentInput,
} from "@/features/equipment/schemas/equipment.schema";
import { requireEmployeeWithOpenShift, requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { equipmentRentalService } from "@/services/equipment/equipment-rental.service";
import { equipmentService } from "@/services/equipment/equipment.service";
import { PERMISSIONS } from "@/types/permissions";

export interface EquipmentActionState {
  error: string | null;
}

export interface CreateEquipmentActionState extends EquipmentActionState {
  equipmentId?: string;
}

function requireEquipmentManage() {
  return requirePermission(PERMISSIONS.EQUIPMENT_MANAGE, "You don't have permission to manage equipment.");
}

function revalidateEquipment(equipmentId: string): void {
  revalidatePath("/dashboard/equipment");
  revalidatePath(`/dashboard/equipment/${equipmentId}`);
  revalidatePath("/dashboard/equipment/rentals");
}

export async function createEquipmentAction(
  input: CreateEquipmentInput,
): Promise<CreateEquipmentActionState> {
  const authz = await requireEquipmentManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createEquipmentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid equipment details." };
  }

  try {
    const equipment = await equipmentService.createEquipment(parsed.data, authz.userId);
    revalidatePath("/dashboard/equipment");
    return { error: null, equipmentId: equipment.id };
  } catch (error) {
    return { error: toActionError(error, { action: "createEquipmentAction", userId: authz.userId }) };
  }
}

export async function updateEquipmentAction(
  equipmentId: string,
  input: UpdateEquipmentInput,
): Promise<EquipmentActionState> {
  const authz = await requireEquipmentManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateEquipmentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid equipment details." };
  }

  try {
    await equipmentService.updateEquipment(equipmentId, parsed.data, authz.userId);
    revalidateEquipment(equipmentId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "updateEquipmentAction", userId: authz.userId }) };
  }
}

export async function createEquipmentRentalAction(
  equipmentId: string,
  input: CreateEquipmentRentalInput,
): Promise<EquipmentActionState> {
  const authz = await requireEmployeeWithOpenShift(
    PERMISSIONS.EQUIPMENT_MANAGE,
    "You don't have permission to manage equipment.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createEquipmentRentalSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid rental details." };
  }

  try {
    await equipmentRentalService.createRental(equipmentId, parsed.data, authz.userId, {
      employeeId: authz.employeeId,
      shiftId: authz.shiftId,
      paymentMethodId: parsed.data.paymentMethodId,
    });
    revalidateEquipment(equipmentId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "createEquipmentRentalAction", userId: authz.userId }),
    };
  }
}

export async function returnEquipmentRentalAction(
  rentalId: string,
  equipmentId?: string,
): Promise<EquipmentActionState> {
  const authz = await requireEquipmentManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await equipmentRentalService.returnRental(rentalId, authz.userId);
    revalidatePath("/dashboard/equipment/rentals");
    revalidatePath(`/dashboard/equipment/rentals/${rentalId}`);
    if (equipmentId) {
      revalidateEquipment(equipmentId);
    }
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "returnEquipmentRentalAction", userId: authz.userId }),
    };
  }
}

export async function markEquipmentLostAction(
  rentalId: string,
  equipmentId?: string,
): Promise<EquipmentActionState> {
  const authz = await requireEquipmentManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await equipmentRentalService.markLost(rentalId, authz.userId);
    revalidatePath("/dashboard/equipment/rentals");
    revalidatePath(`/dashboard/equipment/rentals/${rentalId}`);
    if (equipmentId) {
      revalidateEquipment(equipmentId);
    }
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "markEquipmentLostAction", userId: authz.userId }) };
  }
}

export async function logEquipmentMaintenanceAction(
  equipmentId: string,
  input: LogMaintenanceInput,
): Promise<EquipmentActionState> {
  const authz = await requireEquipmentManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = logMaintenanceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid maintenance details." };
  }

  try {
    await equipmentService.logMaintenance(equipmentId, parsed.data, authz.userId);
    revalidateEquipment(equipmentId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "logEquipmentMaintenanceAction", userId: authz.userId }),
    };
  }
}

export async function resolveEquipmentMaintenanceAction(
  logId: string,
  equipmentId: string,
  input: ResolveMaintenanceInput,
): Promise<EquipmentActionState> {
  const authz = await requireEquipmentManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = resolveMaintenanceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details." };
  }

  try {
    await equipmentService.resolveMaintenanceLog(logId, parsed.data, authz.userId);
    revalidateEquipment(equipmentId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "resolveEquipmentMaintenanceAction",
        userId: authz.userId,
      }),
    };
  }
}
