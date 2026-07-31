"use server";

import { revalidatePath } from "next/cache";

import {
  refundRegistrationInputSchema,
  registerWalkInInputSchema,
  releaseRegistrationInputSchema,
  updateRegistrationDetailsInputSchema,
  type RefundRegistrationInput,
  type RegisterWalkInInput,
  type ReleaseRegistrationInput,
  type UpdateRegistrationDetailsInput,
} from "@/features/open-play-capacity/schemas/open-play-registration.schema";
import {
  requireEmployee,
  requireEmployeeWithOpenShift,
  requirePermission,
} from "@/lib/action-auth";
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
  return requirePermission(
    PERMISSIONS.OPEN_PLAY_MANAGE,
    "You don't have permission to manage open play.",
  );
}

// Gate 2 review follow-up: this action now creates a Sale (the ₱150
// registration fee), so — same standard as settleTabAction and every
// other Sale-creating action in this app — it needs a real Employee
// and a currently open Shift, not just the permission check alone.
function requireOpenPlayManageWithOpenShift() {
  return requireEmployeeWithOpenShift(
    PERMISSIONS.OPEN_PLAY_MANAGE,
    "You don't have permission to manage open play.",
  );
}

// The client panels also call router.refresh() after a successful action
// (force-dynamic pages don't strictly need this), but revalidating here
// too covers any other tab/user looking at the same night.
function revalidateSession(): void {
  revalidatePath("/dashboard/admin/open-play-capacity");
}

export async function registerWalkInAction(
  input: RegisterWalkInInput,
): Promise<OpenPlayRegistrationActionState> {
  const authz = await requireOpenPlayManageWithOpenShift();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = registerWalkInInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid registration." };
  }

  if (parsed.data.method === "GCASH" && !parsed.data.gcashReference?.trim()) {
    return { error: "A GCash reference number is required." };
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
      {
        method: parsed.data.method,
        gcashReference: parsed.data.gcashReference ?? null,
        paymentMethodId: parsed.data.paymentMethodId,
        employeeId: authz.employeeId,
        shiftId: authz.shiftId,
      },
    );
    revalidateSession();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "registerWalkInAction", userId: authz.userId }),
    };
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

export async function cancelRegistrationAction(
  input: ReleaseRegistrationInput,
): Promise<OpenPlayRegistrationActionState> {
  return releaseRegistration(
    input,
    (id, userId) => openPlayRegistrationService.cancelRegistration(id, userId),
    "cancelRegistrationAction",
  );
}

export async function markNoShowAction(
  input: ReleaseRegistrationInput,
): Promise<OpenPlayRegistrationActionState> {
  return releaseRegistration(
    input,
    (id, userId) => openPlayRegistrationService.markNoShow(id, userId),
    "markNoShowAction",
  );
}

export async function markCheckedOutAction(
  input: ReleaseRegistrationInput,
): Promise<OpenPlayRegistrationActionState> {
  return releaseRegistration(
    input,
    (id, userId) => openPlayRegistrationService.markCheckedOut(id, userId),
    "markCheckedOutAction",
  );
}

// Reported live: leftover test registrations (made while trying out the
// public form) had no cleanup path short of direct database access. Safety
// guards (blocked on a real Sale, real game participation, or a
// CONFIRMED/CHECKED_OUT status) live in the service layer, not here — see
// openPlayRegistrationService.deleteRegistration's own comment.
export async function deleteRegistrationAction(
  input: ReleaseRegistrationInput,
): Promise<OpenPlayRegistrationActionState> {
  return releaseRegistration(
    input,
    (id, userId) => openPlayRegistrationService.deleteRegistration(id, userId),
    "deleteRegistrationAction",
  );
}

// Reported live: no way anywhere to fix a typo'd name or phone number
// on an existing registration short of cancelling and re-registering.
// Same permission as every other day-to-day roster edit in this file —
// not a money-adjustment action, so requireOpenPlayManage (not the
// Employee/open-shift variant) is enough.
export async function updateRegistrationDetailsAction(
  input: UpdateRegistrationDetailsInput,
): Promise<OpenPlayRegistrationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateRegistrationDetailsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRegistrationService.updateRegistrationDetails(
      parsed.data.registrationId,
      { playerName: parsed.data.playerName, phone: parsed.data.phone },
      authz.userId,
    );
    revalidateSession();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "updateRegistrationDetailsAction",
        userId: authz.userId,
      }),
    };
  }
}

// Cancellation policy Gate 1 — staff refund path. Same permission as
// every other open-play money-adjustment action (writeOffTabAction's
// own precedent: OPEN_PLAY_MANAGE, not a dedicated new permission) and
// same Employee-attribution requirement (requireEmployee, not just
// requirePermission) — a refund needs a real Employee behind it, same
// "no anonymous refunds" reasoning as write-offs.
export async function refundRegistrationAction(
  input: RefundRegistrationInput,
): Promise<OpenPlayRegistrationActionState> {
  const authz = await requireEmployee(
    PERMISSIONS.OPEN_PLAY_MANAGE,
    "You don't have permission to refund open play registrations.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = refundRegistrationInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid refund." };
  }

  try {
    await openPlayRegistrationService.refundRegistration(
      parsed.data.registrationId,
      parsed.data.amountCents,
      parsed.data.reason,
      authz.employeeId,
      authz.userId,
    );
    revalidateSession();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "refundRegistrationAction", userId: authz.userId }),
    };
  }
}
