"use server";

import { revalidatePath } from "next/cache";

import {
  createLockerRentalSchema,
  createLockerSchema,
  logMaintenanceSchema,
  resolveMaintenanceSchema,
  updateLockerSchema,
  type CreateLockerInput,
  type CreateLockerRentalInput,
  type LogMaintenanceInput,
  type ResolveMaintenanceInput,
  type UpdateLockerInput,
} from "@/features/lockers/schemas/locker.schema";
import { requireEmployeeWithOpenShift, requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { MODULE_KEYS } from "@/lib/module-flags";
import { lockerRentalService } from "@/services/lockers/locker-rental.service";
import { lockerService } from "@/services/lockers/locker.service";
import { settingsService } from "@/services/settings/settings.service";
import { PERMISSIONS } from "@/types/permissions";

export interface LockerActionState {
  error: string | null;
}

export interface CreateLockerActionState extends LockerActionState {
  lockerId?: string;
}

function requireEquipmentManage() {
  return requirePermission(PERMISSIONS.EQUIPMENT_MANAGE, "You don't have permission to manage lockers.");
}

function revalidateLocker(lockerId: string): void {
  revalidatePath("/dashboard/lockers");
  revalidatePath(`/dashboard/lockers/${lockerId}`);
  revalidatePath("/dashboard/lockers/rentals");
}

export async function createLockerAction(input: CreateLockerInput): Promise<CreateLockerActionState> {
  const authz = await requireEquipmentManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createLockerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid locker details." };
  }

  try {
    const locker = await lockerService.createLocker(parsed.data, authz.userId);
    revalidatePath("/dashboard/lockers");
    return { error: null, lockerId: locker.id };
  } catch (error) {
    return { error: toActionError(error, { action: "createLockerAction", userId: authz.userId }) };
  }
}

export async function updateLockerAction(
  lockerId: string,
  input: UpdateLockerInput,
): Promise<LockerActionState> {
  const authz = await requireEquipmentManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateLockerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid locker details." };
  }

  try {
    await lockerService.updateLocker(lockerId, parsed.data, authz.userId);
    revalidateLocker(lockerId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "updateLockerAction", userId: authz.userId }) };
  }
}

export async function createLockerRentalAction(
  lockerId: string,
  input: CreateLockerRentalInput,
): Promise<LockerActionState> {
  const authz = await requireEmployeeWithOpenShift(
    PERMISSIONS.EQUIPMENT_MANAGE,
    "You don't have permission to manage lockers.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const enabledModules = await settingsService.getEnabledModules();
  if (!enabledModules[MODULE_KEYS.LOCKER_RENTAL]) {
    return { error: "Locker rental is currently unavailable." };
  }

  const parsed = createLockerRentalSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid rental details." };
  }

  try {
    await lockerRentalService.createRental(lockerId, parsed.data, authz.userId, {
      employeeId: authz.employeeId,
      shiftId: authz.shiftId,
      paymentMethodId: parsed.data.paymentMethodId,
    });
    revalidateLocker(lockerId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "createLockerRentalAction", userId: authz.userId }),
    };
  }
}

export async function returnLockerRentalAction(
  rentalId: string,
  lockerId?: string,
): Promise<LockerActionState> {
  const authz = await requireEquipmentManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await lockerRentalService.returnRental(rentalId, authz.userId);
    revalidatePath("/dashboard/lockers/rentals");
    revalidatePath(`/dashboard/lockers/rentals/${rentalId}`);
    if (lockerId) {
      revalidateLocker(lockerId);
    }
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "returnLockerRentalAction", userId: authz.userId }),
    };
  }
}

export async function logLockerMaintenanceAction(
  lockerId: string,
  input: LogMaintenanceInput,
): Promise<LockerActionState> {
  const authz = await requireEquipmentManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = logMaintenanceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid maintenance details." };
  }

  try {
    await lockerService.logMaintenance(lockerId, parsed.data, authz.userId);
    revalidateLocker(lockerId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "logLockerMaintenanceAction", userId: authz.userId }),
    };
  }
}

export async function resolveLockerMaintenanceAction(
  logId: string,
  lockerId: string,
  input: ResolveMaintenanceInput,
): Promise<LockerActionState> {
  const authz = await requireEquipmentManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = resolveMaintenanceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details." };
  }

  try {
    await lockerService.resolveMaintenanceLog(logId, parsed.data, authz.userId);
    revalidateLocker(lockerId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "resolveLockerMaintenanceAction", userId: authz.userId }),
    };
  }
}
