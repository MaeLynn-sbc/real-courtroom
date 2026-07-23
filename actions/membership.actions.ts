"use server";

import { revalidatePath } from "next/cache";

import {
  changePlanSchema,
  createPlanSchema,
  enrollMembershipSchema,
  membershipNoteSchema,
  updatePlanSchema,
  type ChangePlanInput,
  type CreatePlanInput,
  type EnrollMembershipInput,
  type MembershipNoteInput,
  type UpdatePlanInput,
} from "@/features/memberships/schemas/membership.schema";
import { requireEmployeeWithOpenShift, requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { MODULE_KEYS } from "@/lib/module-flags";
import { membershipService } from "@/services/memberships/membership.service";
import { settingsService } from "@/services/settings/settings.service";
import { PERMISSIONS } from "@/types/permissions";

export interface MembershipActionState {
  error: string | null;
}

export interface EnrollMembershipActionState extends MembershipActionState {
  membershipId?: string;
}

export interface CreatePlanActionState extends MembershipActionState {
  planId?: string;
}

function requirePlayersManage() {
  return requirePermission(PERMISSIONS.PLAYERS_MANAGE, "You don't have permission to manage memberships.");
}

function revalidateMembership(membershipId: string, playerId?: string): void {
  revalidatePath("/dashboard/memberships");
  revalidatePath(`/dashboard/memberships/${membershipId}`);
  if (playerId) {
    revalidatePath(`/dashboard/players/${playerId}`);
  }
}

export async function createPlanAction(input: CreatePlanInput): Promise<CreatePlanActionState> {
  const authz = await requirePlayersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createPlanSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid plan details." };
  }

  try {
    const plan = await membershipService.createPlan(parsed.data, authz.userId);
    revalidatePath("/dashboard/memberships/plans");
    return { error: null, planId: plan.id };
  } catch (error) {
    return { error: toActionError(error, { action: "createPlanAction", userId: authz.userId }) };
  }
}

export async function updatePlanAction(
  planId: string,
  input: UpdatePlanInput,
): Promise<MembershipActionState> {
  const authz = await requirePlayersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updatePlanSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid plan details." };
  }

  try {
    await membershipService.updatePlan(planId, parsed.data, authz.userId);
    revalidatePath("/dashboard/memberships/plans");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "updatePlanAction", userId: authz.userId }) };
  }
}

export async function enrollMembershipAction(
  playerId: string,
  input: EnrollMembershipInput,
): Promise<EnrollMembershipActionState> {
  const authz = await requireEmployeeWithOpenShift(
    PERMISSIONS.PLAYERS_MANAGE,
    "You don't have permission to manage memberships.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const enabledModules = await settingsService.getEnabledModules();
  if (!enabledModules[MODULE_KEYS.MEMBERSHIP]) {
    return { error: "Membership enrollment is currently unavailable." };
  }

  const parsed = enrollMembershipSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid enrollment details." };
  }

  try {
    const membership = await membershipService.enrollPlayer(playerId, parsed.data, authz.userId, {
      employeeId: authz.employeeId,
      shiftId: authz.shiftId,
      paymentMethodId: parsed.data.paymentMethodId,
    });
    revalidatePath("/dashboard/memberships");
    revalidatePath(`/dashboard/players/${playerId}`);
    return { error: null, membershipId: membership.id };
  } catch (error) {
    return { error: toActionError(error, { action: "enrollMembershipAction", userId: authz.userId }) };
  }
}

export async function renewMembershipAction(
  membershipId: string,
  playerId?: string,
): Promise<MembershipActionState> {
  const authz = await requirePlayersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await membershipService.renewMembership(membershipId, authz.userId);
    revalidateMembership(membershipId, playerId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "renewMembershipAction", userId: authz.userId }) };
  }
}

export async function changePlanAction(
  membershipId: string,
  input: ChangePlanInput,
  playerId?: string,
): Promise<MembershipActionState> {
  const authz = await requirePlayersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = changePlanSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Select a plan." };
  }

  try {
    await membershipService.changePlan(membershipId, parsed.data, authz.userId);
    revalidateMembership(membershipId, playerId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "changePlanAction", userId: authz.userId }) };
  }
}

export async function suspendMembershipAction(
  membershipId: string,
  input: MembershipNoteInput,
  playerId?: string,
): Promise<MembershipActionState> {
  const authz = await requirePlayersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = membershipNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid note." };
  }

  try {
    await membershipService.suspendMembership(membershipId, parsed.data.note, authz.userId);
    revalidateMembership(membershipId, playerId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "suspendMembershipAction", userId: authz.userId }) };
  }
}

export async function reactivateMembershipAction(
  membershipId: string,
  playerId?: string,
): Promise<MembershipActionState> {
  const authz = await requirePlayersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await membershipService.reactivateMembership(membershipId, authz.userId);
    revalidateMembership(membershipId, playerId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "reactivateMembershipAction", userId: authz.userId }),
    };
  }
}

export async function cancelMembershipAction(
  membershipId: string,
  input: MembershipNoteInput,
  playerId?: string,
): Promise<MembershipActionState> {
  const authz = await requirePlayersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = membershipNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid note." };
  }

  try {
    await membershipService.cancelMembership(membershipId, parsed.data.note, authz.userId);
    revalidateMembership(membershipId, playerId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "cancelMembershipAction", userId: authz.userId }) };
  }
}
