"use server";

import { revalidatePath } from "next/cache";

import {
  assignmentIdInputSchema,
  assignStagedGroupToCourtInputSchema,
  manualAssignmentInputSchema,
  moveQueueUnitAfterInputSchema,
  proposeAssignmentInputSchema,
  queueEntryIdInputSchema,
  stageAutoQueueInputSchema,
  stagedGroupIdInputSchema,
  stageManualGroupInputSchema,
  swapPartyMemberInputSchema,
  type AssignmentIdInput,
  type AssignStagedGroupToCourtInput,
  type ManualAssignmentInput,
  type MoveQueueUnitAfterInput,
  type ProposeAssignmentInput,
  type QueueEntryIdInput,
  type StageAutoQueueInput,
  type StagedGroupIdInput,
  type StageManualGroupInput,
  type SwapPartyMemberInput,
} from "@/features/open-play-capacity/schemas/open-play-rotation.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  AssignmentAlreadyCompletedError,
  openPlayRotationService,
} from "@/services/open-play/open-play-rotation.service";
import { PERMISSIONS } from "@/types/permissions";

export interface OpenPlayRotationActionState {
  error: string | null;
}

function requireOpenPlayManage() {
  return requirePermission(
    PERMISSIONS.OPEN_PLAY_MANAGE,
    "You don't have permission to manage open play.",
  );
}

function revalidateRotation(): void {
  revalidatePath("/dashboard/admin/open-play-capacity");
}

function parseDate(dateParam: string): Date {
  return new Date(`${dateParam}T00:00:00`);
}

export async function proposeAssignmentAction(
  input: ProposeAssignmentInput,
): Promise<OpenPlayRotationActionState> {
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
    return {
      error: toActionError(error, { action: "proposeAssignmentAction", userId: authz.userId }),
    };
  }
}

export async function createManualAssignmentAction(
  input: ManualAssignmentInput,
): Promise<OpenPlayRotationActionState> {
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
    return {
      error: toActionError(error, { action: "createManualAssignmentAction", userId: authz.userId }),
    };
  }
}

// "Put the action where the group is" — assigns a STAGED group (Next up/
// After that/Then) straight to a court, instead of staff scrolling up to
// a court card. Works from any slot, not only Next up. Same
// requireOpenPlayManage() gate as every other rotation action. The
// service method's own occupied-court, real-membership-resolution, and
// pipeline-advance logic are what make the race in requirement 8 fail
// clean; nothing extra needed here.
export async function assignPendingGroupToCourtAction(
  input: AssignStagedGroupToCourtInput,
): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = assignStagedGroupToCourtInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.assignPendingGroupToCourt(
      parseDate(parsed.data.date),
      parsed.data.courtId,
      parsed.data.stagedGroupId,
      authz.userId,
    );
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "assignPendingGroupToCourtAction",
        userId: authz.userId,
      }),
    };
  }
}

// Auto queue: takes the next `size` waiting players, strict FIFO, into
// `slot`.
export async function stageAutoQueueAction(
  input: StageAutoQueueInput,
): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = stageAutoQueueInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.stageAutoQueue(
      parseDate(parsed.data.date),
      parsed.data.slot,
      parsed.data.size,
      authz.userId,
    );
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "stageAutoQueueAction", userId: authz.userId }),
    };
  }
}

// Build by hand, targeting a slot instead of a court.
export async function stageManualGroupAction(
  input: StageManualGroupInput,
): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = stageManualGroupInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.stageManualGroup(
      parseDate(parsed.data.date),
      parsed.data.slot,
      parsed.data.registrationIds,
      authz.userId,
    );
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "stageManualGroupAction", userId: authz.userId }),
    };
  }
}

// The × control on a staged chip.
export async function unstageQueueEntryAction(
  input: QueueEntryIdInput,
): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = queueEntryIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.unstageQueueEntry(parsed.data.queueEntryId, authz.userId);
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "unstageQueueEntryAction", userId: authz.userId }),
    };
  }
}

// Removing a whole staged group at once.
export async function unstageGroupAction(
  input: StagedGroupIdInput,
): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = stagedGroupIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.unstageGroup(parsed.data.stagedGroupId, authz.userId);
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "unstageGroupAction", userId: authz.userId }),
    };
  }
}

export async function confirmAssignmentAction(
  input: AssignmentIdInput,
): Promise<OpenPlayRotationActionState> {
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
    return {
      error: toActionError(error, { action: "confirmAssignmentAction", userId: authz.userId }),
    };
  }
}

// Manual timer/announce: same requireOpenPlayManage() gate as create/
// confirm above, so attendants already reach this — no new permission
// needed (unlike TV-display settings, RECEPTIONIST already holds
// OPEN_PLAY_MANAGE). Re-pressable: no state check beyond the service's own
// PROPOSED/ACTIVE guard, so pressing this again just re-stamps the
// timestamp the TV watches.
export async function announceAssignmentAction(
  input: AssignmentIdInput,
): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = assignmentIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.announceAssignment(parsed.data.assignmentId, authz.userId);
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "announceAssignmentAction", userId: authz.userId }),
    };
  }
}

// "Time's up" — manual call to players off the court, same permission
// and shape as announceAssignmentAction above.
export async function announceTimesUpAction(
  input: AssignmentIdInput,
): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = assignmentIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.announceTimesUp(parsed.data.assignmentId, authz.userId);
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "announceTimesUpAction", userId: authz.userId }),
    };
  }
}

export async function cancelAssignmentAction(
  input: AssignmentIdInput,
): Promise<OpenPlayRotationActionState> {
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
    return {
      error: toActionError(error, { action: "cancelAssignmentAction", userId: authz.userId }),
    };
  }
}

export async function completeAssignmentAction(
  input: AssignmentIdInput,
): Promise<OpenPlayRotationActionState> {
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
      logger.info(
        { assignmentId: parsed.data.assignmentId, userId: authz.userId },
        "completeAssignmentAction: already completed, no-op",
      );
      revalidateRotation();
      return { error: null };
    }
    return {
      error: toActionError(error, { action: "completeAssignmentAction", userId: authz.userId }),
    };
  }
}

export async function markRestingAction(
  input: QueueEntryIdInput,
): Promise<OpenPlayRotationActionState> {
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

export async function markWaitingAgainAction(
  input: QueueEntryIdInput,
): Promise<OpenPlayRotationActionState> {
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
    return {
      error: toActionError(error, { action: "markWaitingAgainAction", userId: authz.userId }),
    };
  }
}

// Queue reorder: same requireOpenPlayManage() gate — no new permission
// needed. Moves a whole unit (solo or party) to sit right after a chosen,
// later-queued player; everyone passed advances automatically, since
// nobody else's row is touched (see moveQueueUnitAfter's own comment).
export async function moveQueueUnitAfterAction(
  input: MoveQueueUnitAfterInput,
): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = moveQueueUnitAfterInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.moveQueueUnitAfter(
      parseDate(parsed.data.date),
      parsed.data.movingRegistrationIds,
      parsed.data.targetRegistrationId,
      authz.userId,
    );
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "moveQueueUnitAfterAction", userId: authz.userId }),
    };
  }
}

export async function swapPartyMemberAction(
  input: SwapPartyMemberInput,
): Promise<OpenPlayRotationActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = swapPartyMemberInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayRotationService.swapPartyMember(
      parseDate(parsed.data.date),
      parsed.data.memberARegistrationId,
      parsed.data.memberBRegistrationId,
      authz.userId,
    );
    revalidateRotation();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "swapPartyMemberAction", userId: authz.userId }),
    };
  }
}

export async function markDoneAction(
  input: QueueEntryIdInput,
): Promise<OpenPlayRotationActionState> {
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
