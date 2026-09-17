"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { practiceService } from "@/services/open-play/practice.service";
import { PERMISSIONS } from "@/types/permissions";

export interface PracticeActionState {
  error: string | null;
}

// Practice uses the same permission as the real open play screens: the
// people who run open play are the ones rehearsing it.
function requireOpenPlayManage() {
  return requirePermission(
    PERMISSIONS.OPEN_PLAY_MANAGE,
    "You don't have permission to manage open play.",
  );
}

function revalidatePractice() {
  revalidatePath("/dashboard/practice");
}

const addPracticePlayerSchema = z.object({
  playerName: z.string().trim().min(1, "Enter a name.").max(200),
  skillLevel: z.enum(["BEGINNER", "NOVICE", "INTERMEDIATE", "ADVANCED"]),
});

export async function addPracticePlayerAction(
  input: z.infer<typeof addPracticePlayerSchema>,
): Promise<PracticeActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) return { error: authz.error };
  const parsed = addPracticePlayerSchema.safeParse(input);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Invalid practice player." };
  try {
    await practiceService.addPracticePlayer(parsed.data, authz.userId);
    revalidatePractice();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "addPracticePlayerAction", userId: authz.userId }),
    };
  }
}

export async function removePracticePlayerAction(
  registrationId: string,
): Promise<PracticeActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) return { error: authz.error };
  try {
    await practiceService.removePracticePlayer(registrationId, authz.userId);
    revalidatePractice();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "removePracticePlayerAction", userId: authz.userId }),
    };
  }
}

export async function addSamplePracticePlayersAction(): Promise<
  PracticeActionState & { added?: number }
> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) return { error: authz.error };
  try {
    const { added } = await practiceService.addSamplePlayers(authz.userId);
    revalidatePractice();
    return { error: null, added };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "addSamplePracticePlayersAction",
        userId: authz.userId,
      }),
    };
  }
}

export async function clearPracticeAction(): Promise<PracticeActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) return { error: authz.error };
  try {
    await practiceService.clearPractice(authz.userId);
    revalidatePractice();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "clearPracticeAction", userId: authz.userId }) };
  }
}

export async function setPracticeTakeoverRtvAction(value: boolean): Promise<PracticeActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) return { error: authz.error };
  try {
    await practiceService.setTakeoverRtv(value, authz.userId);
    revalidatePractice();
    revalidatePath("/rtv");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "setPracticeTakeoverRtvAction", userId: authz.userId }),
    };
  }
}
