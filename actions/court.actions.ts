"use server";

import { revalidatePath } from "next/cache";

import {
  courtMaintenanceSchema,
  courtStatusSchema,
  createCourtSchema,
  maintenanceStatusSchema,
  specialEventSchema,
  updateCourtSchema,
  updateSpecialEventTimingSchema,
  type CourtMaintenanceInput,
  type CreateCourtInput,
  type SpecialEventInput,
  type UpdateCourtInput,
  type UpdateSpecialEventTimingInput,
} from "@/features/courts/schemas/court.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { courtService } from "@/services/court/court.service";
import { PERMISSIONS } from "@/types/permissions";

export interface CourtActionState {
  error: string | null;
}

export interface CreateCourtActionState extends CourtActionState {
  courtId?: string;
}

function requireCourtsManage() {
  return requirePermission(PERMISSIONS.COURTS_MANAGE, "You don't have permission to manage courts.");
}

export async function createCourtAction(
  input: CreateCourtInput,
): Promise<CreateCourtActionState> {
  const authz = await requireCourtsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createCourtSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid court details." };
  }

  try {
    const court = await courtService.createCourt(parsed.data, authz.userId);
    revalidatePath("/dashboard/courts");
    return { error: null, courtId: court.id };
  } catch (error) {
    return { error: toActionError(error, { action: "createCourtAction", userId: authz.userId }) };
  }
}

export async function updateCourtAction(
  courtId: string,
  input: UpdateCourtInput,
): Promise<CourtActionState> {
  const authz = await requireCourtsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateCourtSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid court details." };
  }

  try {
    await courtService.updateCourt(courtId, parsed.data, authz.userId);
    revalidatePath("/dashboard/courts");
    revalidatePath(`/dashboard/courts/${courtId}`);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "updateCourtAction", userId: authz.userId }) };
  }
}

export async function setCourtStatusAction(
  courtId: string,
  status: unknown,
): Promise<CourtActionState> {
  const authz = await requireCourtsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = courtStatusSchema.safeParse({ status });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid status." };
  }

  try {
    await courtService.setCourtStatus(courtId, parsed.data.status, authz.userId);
    revalidatePath("/dashboard/courts");
    revalidatePath(`/dashboard/courts/${courtId}`);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setCourtStatusAction", userId: authz.userId }) };
  }
}

export async function scheduleMaintenanceAction(
  courtId: string,
  input: CourtMaintenanceInput,
): Promise<CourtActionState> {
  const authz = await requireCourtsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = courtMaintenanceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid maintenance details." };
  }

  try {
    await courtService.scheduleMaintenance(courtId, parsed.data, authz.userId);
    revalidatePath(`/dashboard/courts/${courtId}`);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "scheduleMaintenanceAction", userId: authz.userId }),
    };
  }
}

export async function scheduleSpecialEventAction(
  input: SpecialEventInput,
): Promise<CourtActionState> {
  const authz = await requireCourtsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = specialEventSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid special event details." };
  }

  try {
    await courtService.scheduleSpecialEvent(parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/special-events");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "scheduleSpecialEventAction", userId: authz.userId }),
    };
  }
}

export async function updateSpecialEventTimingAction(
  input: UpdateSpecialEventTimingInput,
): Promise<CourtActionState> {
  const authz = await requireCourtsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateSpecialEventTimingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid date or time." };
  }

  try {
    await courtService.updateSpecialEventTiming(
      parsed.data.maintenanceId,
      parsed.data.startAt,
      parsed.data.endAt,
      authz.userId,
    );
    revalidatePath("/dashboard/admin/special-events");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "updateSpecialEventTimingAction", userId: authz.userId }),
    };
  }
}

export async function deleteSpecialEventAction(maintenanceId: string): Promise<CourtActionState> {
  const authz = await requireCourtsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await courtService.deleteSpecialEvent(maintenanceId, authz.userId);
    revalidatePath("/dashboard/admin/special-events");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "deleteSpecialEventAction", userId: authz.userId }),
    };
  }
}

// Reuses updateMaintenanceStatus (already generic across MAINTENANCE and
// SPECIAL_EVENT kinds) — a thin, page-scoped wrapper so the special-
// events admin page doesn't need to know about a courtId-scoped revalidate
// path the way the per-court maintenance action does.
export async function cancelSpecialEventAction(
  maintenanceId: string,
): Promise<CourtActionState> {
  const authz = await requireCourtsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await courtService.updateMaintenanceStatus(maintenanceId, "CANCELLED", authz.userId);
    revalidatePath("/dashboard/admin/special-events");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "cancelSpecialEventAction", userId: authz.userId }),
    };
  }
}

export async function updateMaintenanceStatusAction(
  maintenanceId: string,
  courtId: string,
  status: unknown,
): Promise<CourtActionState> {
  const authz = await requireCourtsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = maintenanceStatusSchema.safeParse({ status });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid status." };
  }

  try {
    await courtService.updateMaintenanceStatus(maintenanceId, parsed.data.status, authz.userId);
    revalidatePath(`/dashboard/courts/${courtId}`);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "updateMaintenanceStatusAction", userId: authz.userId }),
    };
  }
}
