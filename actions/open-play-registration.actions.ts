"use server";

import { revalidatePath } from "next/cache";

import {
  registerWalkInInputSchema,
  releaseRegistrationInputSchema,
  type RegisterWalkInInput,
  type ReleaseRegistrationInput,
} from "@/features/open-play-capacity/schemas/open-play-registration.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { openPlayRegistrationService } from "@/services/open-play/open-play-registration.service";
import { PERMISSIONS } from "@/types/permissions";

export interface OpenPlayRegistrationActionState {
  error: string | null;
}

// Day-to-day staff operation (unlike Open Play Capacity's owner-only
// weekday defaults/overrides) — same permission the existing rotation
// feature's registration actions use.
function requireOpenPlayManage() {
  return requirePermission(PERMISSIONS.OPEN_PLAY_MANAGE, "You don't have permission to manage open play.");
}

// The client panels also call router.refresh() after a successful action
// (force-dynamic pages don't strictly need this), but revalidating here
// too covers any other tab/user looking at the same night.
function revalidateSession(): void {
  revalidatePath("/dashboard/admin/open-play-capacity");
}

export async function registerWalkInAction(input: RegisterWalkInInput): Promise<OpenPlayRegistrationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = registerWalkInInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid registration." };
  }

  try {
    await openPlayRegistrationService.registerWalkIn(
      parsed.data.sessionId,
      {
        playerName: parsed.data.playerName,
        phone: parsed.data.phone,
        skillLevel: parsed.data.skillLevel,
        partyId: parsed.data.partyId,
      },
      authz.userId,
    );
    revalidateSession();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "registerWalkInAction", userId: authz.userId }) };
  }
}

async function releaseRegistration(
  input: ReleaseRegistrationInput,
  release: (registrationId: string, actorUserId: string) => Promise<unknown>,
  actionName: string,
): Promise<OpenPlayRegistrationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = releaseRegistrationInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await release(parsed.data.registrationId, authz.userId);
    revalidateSession();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: actionName, userId: authz.userId }) };
  }
}

export async function cancelRegistrationAction(input: ReleaseRegistrationInput): Promise<OpenPlayRegistrationActionState> {
  return releaseRegistration(
    input,
    (id, userId) => openPlayRegistrationService.cancelRegistration(id, userId),
    "cancelRegistrationAction",
  );
}

export async function markNoShowAction(input: ReleaseRegistrationInput): Promise<OpenPlayRegistrationActionState> {
  return releaseRegistration(
    input,
    (id, userId) => openPlayRegistrationService.markNoShow(id, userId),
    "markNoShowAction",
  );
}

export async function markCheckedOutAction(input: ReleaseRegistrationInput): Promise<OpenPlayRegistrationActionState> {
  return releaseRegistration(
    input,
    (id, userId) => openPlayRegistrationService.markCheckedOut(id, userId),
    "markCheckedOutAction",
  );
}
