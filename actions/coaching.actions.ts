"use server";

import { revalidatePath } from "next/cache";

import {
  copyWeekAvailabilitySchema,
  createCoachSessionSchema,
  setDayAvailabilitySchema,
  upsertCoachRateSchema,
  type CopyWeekAvailabilityInput,
  type CreateCoachSessionInput,
  type SetDayAvailabilityInput,
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

export interface StaffCoachOption {
  id: string;
  name: string;
  // Full group-size -> price table, same shape as
  // PublicBookingCoachOption — but unlike the public path, staff see a
  // coach here even with an empty rate table (matches CoachSessionPanel's
  // existing "no rates filter" behavior on the booking detail page); an
  // unpriced group size is caught at submit time instead, not hidden by
  // never offering the coach at all.
  rates: { groupSize: number; priceCents: number }[];
}

export interface ListCoachAvailabilityState {
  error: string | null;
  coaches: StaffCoachOption[];
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

// The week-grid's one write path — replaces the ownership-only
// createAvailabilityWindowAction/deleteAvailabilityWindowAction pair
// (removed; nothing else called them — coachAvailabilityService's own
// createWindow/deleteWindow stay, still used as test fixtures
// throughout services/coaching/*.integration.ts). Ownership (coachId
// must be the caller's own employeeId, unless
// ALLOW_CROSS_COACH_AVAILABILITY_EDITS) is enforced inside the
// service, not just here — see assertCanEditCoach and
// coach-availability-ownership.integration.ts.
export async function setDayAvailabilityAction(input: SetDayAvailabilityInput): Promise<CoachingActionState> {
  const authz = await requireCoachingOwnAvailability();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = setDayAvailabilitySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid availability." };
  }

  try {
    await coachAvailabilityService.setDayAvailability(parsed.data, authz.employeeId, authz.userId);
    revalidatePath("/dashboard/coaching/availability");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setDayAvailabilityAction", userId: authz.userId }) };
  }
}

export async function copyWeekAvailabilityAction(input: CopyWeekAvailabilityInput): Promise<CoachingActionState> {
  const authz = await requireCoachingOwnAvailability();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = copyWeekAvailabilitySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid week." };
  }

  try {
    await coachAvailabilityService.copyWeekAvailability(parsed.data, authz.employeeId, authz.userId);
    revalidatePath("/dashboard/coaching/availability");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "copyWeekAvailabilityAction", userId: authz.userId }) };
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

// Live preview for the staff booking form's (not-yet-submitted) coach
// section — same underlying query the public path already uses
// (coachAvailabilityService.listAvailableCoaches), gated by
// bookings:manage since it's read alongside the booking form, not a
// coaching-specific screen. Unlike createPublicBookingAction's
// availableCoaches, no rates.length filter here — staff can see and pick
// a coach with no rate table at all, the same as CoachSessionPanel
// already allows on the booking detail page.
export async function listAvailableCoachesForSlotAction(
  startAt: Date,
  endAt: Date,
): Promise<ListCoachAvailabilityState> {
  const authz = await requireBookingsManage();
  if (!authz.ok) {
    return { error: authz.error, coaches: [] };
  }

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt.getTime() <= startAt.getTime()) {
    return { error: null, coaches: [] };
  }

  const coaches = await coachAvailabilityService.listAvailableCoaches(startAt, endAt);
  const coachOptions: StaffCoachOption[] = await Promise.all(
    coaches.map(async (coach) => ({
      id: coach.id,
      name: coach.user.name ?? coach.user.email ?? "Coach",
      rates: (await coachRateService.listRates(coach.id)).map((rate) => ({
        groupSize: rate.groupSize,
        priceCents: rate.priceCents,
      })),
    })),
  );

  return { error: null, coaches: coachOptions };
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
