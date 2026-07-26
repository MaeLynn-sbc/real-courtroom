"use server";

import { revalidatePath } from "next/cache";

import {
  createAvailabilityWindowSchema,
  createCoachSessionSchema,
  upsertCoachRateSchema,
  type CreateAvailabilityWindowInput,
  type CreateCoachSessionInput,
  type UpsertCoachRateInput,
} from "@/features/coaching/schemas/coaching.schema";
import { requireEmployee, requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { coachAvailabilityService } from "@/services/coaching/coach-availability.service";
import { coachRateService } from "@/services/coaching/coach-rate.service";
import { coachSessionService, CoachSessionConflictError } from "@/services/coaching/coach-session.service";
import { PERMISSIONS } from "@/types/permissions";

export interface CoachingActionState {
  error: string | null;
}

export interface CreateCoachSessionActionState extends CoachingActionState {
  coachSessionId?: string;
}

function requireCoachingOwnAvailability() {
  return requireEmployee(
    PERMISSIONS.COACHING_MANAGE_OWN_AVAILABILITY,
    "You don't have permission to manage coaching availability.",
  );
}

function requireCoachingRates() {
  return requirePermission(PERMISSIONS.COACHING_MANAGE_RATES, "You don't have permission to manage coaching rates.");
}

// Staff desk booking — reuses bookings:manage, the same permission that
// gates creating the court booking this attaches to. Item 4 spec'd only
// two new permissions (availability, rates); attaching a coach to a
// booking is scoped as part of "managing bookings," not a third one.
function requireBookingsManage() {
  return requirePermission(PERMISSIONS.BOOKINGS_MANAGE, "You don't have permission to manage bookings.");
}

export async function createAvailabilityWindowAction(
  input: CreateAvailabilityWindowInput,
): Promise<CoachingActionState> {
  const authz = await requireCoachingOwnAvailability();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createAvailabilityWindowSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid availability window." };
  }

  try {
    // Ownership (coachId must equal the caller's own employeeId) is
    // enforced inside the service, not just here — see
    // CoachAvailabilityService.createWindow and
    // coach-availability-ownership.integration.ts.
    await coachAvailabilityService.createWindow(parsed.data, authz.employeeId, authz.userId);
    revalidatePath("/dashboard/coaching/availability");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "createAvailabilityWindowAction", userId: authz.userId }) };
  }
}

export async function deleteAvailabilityWindowAction(windowId: string): Promise<CoachingActionState> {
  const authz = await requireCoachingOwnAvailability();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await coachAvailabilityService.deleteWindow(windowId, authz.employeeId, authz.userId);
    revalidatePath("/dashboard/coaching/availability");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "deleteAvailabilityWindowAction", userId: authz.userId }) };
  }
}

export async function upsertCoachRateAction(input: UpsertCoachRateInput): Promise<CoachingActionState> {
  const authz = await requireCoachingRates();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = upsertCoachRateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid rate." };
  }

  try {
    await coachRateService.upsertRate(parsed.data, authz.userId);
    revalidatePath("/dashboard/coaching/rates");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "upsertCoachRateAction", userId: authz.userId }) };
  }
}

export async function deleteCoachRateAction(rateId: string): Promise<CoachingActionState> {
  const authz = await requireCoachingRates();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await coachRateService.deleteRate(rateId, authz.userId);
    revalidatePath("/dashboard/coaching/rates");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "deleteCoachRateAction", userId: authz.userId }) };
  }
}

export async function createCoachSessionAction(
  input: CreateCoachSessionInput,
): Promise<CreateCoachSessionActionState> {
  const authz = await requireBookingsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createCoachSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid coach session details." };
  }

  try {
    const coachSession = await coachSessionService.createCoachSession(parsed.data, "STAFF", authz.userId);
    revalidatePath("/dashboard/bookings");
    revalidatePath(`/dashboard/bookings/${parsed.data.bookingId}`);
    revalidatePath("/dashboard/coaching");
    return { error: null, coachSessionId: coachSession.id };
  } catch (error) {
    if (error instanceof CoachSessionConflictError) {
      return { error: error.message };
    }
    return { error: toActionError(error, { action: "createCoachSessionAction", userId: authz.userId }) };
  }
}
