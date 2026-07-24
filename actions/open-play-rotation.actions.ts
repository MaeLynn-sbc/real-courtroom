"use server";

import { revalidatePath } from "next/cache";

import {
  assignmentIdInputSchema,
  manualAssignmentInputSchema,
  proposeAssignmentInputSchema,
  queueEntryIdInputSchema,
  type AssignmentIdInput,
  type ManualAssignmentInput,
  type ProposeAssignmentInput,
  type QueueEntryIdInput,
} from "@/features/open-play-capacity/schemas/open-play-rotation.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { AssignmentAlreadyCompletedError, openPlayRotationService } from "@/services/open-play/open-play-rotation.service";
import { PERMISSIONS } from "@/types/permissions";

export interface OpenPlayRotationActionState {
  error: string | null;
}

function requireOpenPlayManage() {
  return requirePermission(PERMISSIONS.OPEN_PLAY_MANAGE, "You don't have permission to manage open play.");
}

function revalidateRotation(): void {
  revalidatePath("/dashboard/admin/open-play-capacity");
}

function parseDate(dateParam: string): Date {
  return new Date(`${dateParam}T00:00:00`);
}

export async function proposeAssignmentAction(input: ProposeAssignmentInput): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = proposeAssignmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    const assignment = await openPlayRotationService.proposeNextAssignment(
      parseDate(parsed.data.date),
      parsed.data.courtId,
      authz.userId,
    );
    if (!assignment) {
      return { error: "Not enough waiting players to fill a court right now." };
    }
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "proposeAssignmentAction", userId: authz.userId }) };
  }
}

export async function createManualAssignmentAction(input: ManualAssignmentInput): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = manualAssignmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.createManualAssignment(
      parseDate(parsed.data.date),
      parsed.data.courtId,
      parsed.data.registrationIds,
      authz.userId,
    );
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "createManualAssignmentAction", userId: authz.userId }) };
  }
}

export async function confirmAssignmentAction(input: AssignmentIdInput): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = assignmentIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.confirmAssignment(parsed.data.assignmentId, authz.userId);
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "confirmAssignmentAction", userId: authz.userId }) };
  }
}

export async function cancelAssignmentAction(input: AssignmentIdInput): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = assignmentIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.cancelAssignment(parsed.data.assignmentId, authz.userId);
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "cancelAssignmentAction", userId: authz.userId }) };
  }
}

export async function completeAssignmentAction(input: AssignmentIdInput): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = assignmentIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.completeAssignment(parsed.data.assignmentId, authz.userId);
    revalidateRotation();
    return { error: null };
  } catch (error) {
    // A double-tap or a losing concurrent call must be benign at the UI
    // boundary — the game genuinely did get completed, just not by this
    // exact call. Logged (not silently swallowed) so it's still visible
    // server-side, but the staff member sees a normal refresh, not an
    // error toast for something that isn't actually wrong.
    if (error instanceof AssignmentAlreadyCompletedError) {
      logger.info({ assignmentId: parsed.data.assignmentId, userId: authz.userId }, "completeAssignmentAction: already completed, no-op");
      revalidateRotation();
      return { error: null };
    }
    return { error: toActionError(error, { action: "completeAssignmentAction", userId: authz.userId }) };
  }
}

export async function markRestingAction(input: QueueEntryIdInput): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = queueEntryIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.markResting(parsed.data.queueEntryId, authz.userId);
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "markRestingAction", userId: authz.userId }) };
  }
}

export async function markWaitingAgainAction(input: QueueEntryIdInput): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = queueEntryIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.markWaitingAgain(parsed.data.queueEntryId, authz.userId);
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "markWaitingAgainAction", userId: authz.userId }) };
  }
}

export async function markDoneAction(input: QueueEntryIdInput): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = queueEntryIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.markDone(parsed.data.queueEntryId, authz.userId);
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "markDoneAction", userId: authz.userId }) };
  }
}
