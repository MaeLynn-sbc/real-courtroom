"use server";

import { revalidatePath } from "next/cache";

import {
  createOpenPlaySessionSchema,
  registerForSessionSchema,
  updateSessionStatusSchema,
  type CreateOpenPlaySessionInput,
  type RegisterForSessionInput,
  type UpdateSessionStatusInput,
} from "@/features/open-play/schemas/open-play.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { queueService } from "@/services/open-play/queue.service";
import { rotationEngine, type StartNextMatchResult } from "@/services/open-play/rotation-engine";
import { openPlaySessionService } from "@/services/open-play/session.service";
import { PERMISSIONS } from "@/types/permissions";

export interface OpenPlayActionState {
  error: string | null;
}

export interface CreateSessionActionState extends OpenPlayActionState {
  sessionId?: string;
}

export interface StartNextMatchActionState extends OpenPlayActionState {
  result?: StartNextMatchResult;
}

function requireOpenPlayManage() {
  return requirePermission(PERMISSIONS.OPEN_PLAY_MANAGE, "You don't have permission to manage Open Play.");
}

function revalidateSession(sessionId: string): void {
  revalidatePath("/dashboard/open-play");
  revalidatePath(`/dashboard/open-play/${sessionId}`);
}

export async function createSessionAction(
  input: CreateOpenPlaySessionInput,
): Promise<CreateSessionActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createOpenPlaySessionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid session details." };
  }

  try {
    const session = await openPlaySessionService.createSession(parsed.data, authz.userId);
    revalidatePath("/dashboard/open-play");
    return { error: null, sessionId: session.id };
  } catch (error) {
    return { error: toActionError(error, { action: "createSessionAction", userId: authz.userId }) };
  }
}

export async function updateSessionAction(
  sessionId: string,
  input: CreateOpenPlaySessionInput,
): Promise<OpenPlayActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createOpenPlaySessionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid session details." };
  }

  try {
    await openPlaySessionService.updateSession(sessionId, parsed.data, authz.userId);
    revalidateSession(sessionId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "updateSessionAction", userId: authz.userId }) };
  }
}

export async function updateSessionStatusAction(
  sessionId: string,
  input: UpdateSessionStatusInput,
): Promise<OpenPlayActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateSessionStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid status." };
  }

  try {
    await openPlaySessionService.updateSessionStatus(sessionId, parsed.data.status, authz.userId);
    revalidateSession(sessionId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "updateSessionStatusAction", userId: authz.userId }),
    };
  }
}

export async function registerForSessionAction(
  sessionId: string,
  input: RegisterForSessionInput,
): Promise<OpenPlayActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = registerForSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid registration details." };
  }

  try {
    await openPlaySessionService.registerForSession(sessionId, parsed.data, authz.userId);
    revalidateSession(sessionId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "registerForSessionAction", userId: authz.userId }),
    };
  }
}

export async function cancelRegistrationAction(
  sessionId: string,
  registrationId: string,
): Promise<OpenPlayActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await openPlaySessionService.cancelRegistration(registrationId, authz.userId);
    revalidateSession(sessionId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "cancelRegistrationAction", userId: authz.userId }),
    };
  }
}

export async function checkInRegistrationAction(
  sessionId: string,
  registrationId: string,
): Promise<OpenPlayActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await openPlaySessionService.checkInRegistration(registrationId, authz.userId);
    revalidateSession(sessionId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "checkInRegistrationAction", userId: authz.userId }),
    };
  }
}

export async function markNoShowAction(
  sessionId: string,
  registrationId: string,
): Promise<OpenPlayActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await openPlaySessionService.markNoShow(registrationId, authz.userId);
    revalidateSession(sessionId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "markNoShowAction", userId: authz.userId }) };
  }
}

export async function startNextMatchAction(sessionId: string): Promise<StartNextMatchActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    const result = await rotationEngine.startNextMatch(sessionId, authz.userId);
    revalidateSession(sessionId);
    return { error: null, result };
  } catch (error) {
    return { error: toActionError(error, { action: "startNextMatchAction", userId: authz.userId }) };
  }
}

export async function endMatchAction(
  sessionId: string,
  courtId: string,
): Promise<OpenPlayActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await rotationEngine.endMatch(courtId, authz.userId);
    revalidateSession(sessionId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "endMatchAction", userId: authz.userId }) };
  }
}

export async function returnFromRestAction(
  sessionId: string,
  queueId: string,
): Promise<OpenPlayActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await rotationEngine.returnFromRest(queueId, authz.userId);
    revalidateSession(sessionId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "returnFromRestAction", userId: authz.userId }) };
  }
}

export async function removeFromQueueAction(
  sessionId: string,
  queueId: string,
): Promise<OpenPlayActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await queueService.removeFromQueue(queueId);
    revalidateSession(sessionId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "removeFromQueueAction", userId: authz.userId }) };
  }
}
