"use server";

import { revalidatePath } from "next/cache";

import {
  createPlayerSchema,
  updatePlayerSchema,
  type CreatePlayerInput,
  type UpdatePlayerInput,
} from "@/features/players/schemas/player.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { playerService } from "@/services/player/player.service";
import { PERMISSIONS } from "@/types/permissions";

export interface PlayerActionState {
  error: string | null;
}

export interface CreatePlayerActionState extends PlayerActionState {
  playerId?: string;
}

function requirePlayersManage() {
  return requirePermission(PERMISSIONS.PLAYERS_MANAGE, "You don't have permission to manage players.");
}

export async function createPlayerAction(input: CreatePlayerInput): Promise<CreatePlayerActionState> {
  const authz = await requirePlayersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createPlayerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid player details." };
  }

  try {
    const player = await playerService.createPlayer(parsed.data, authz.userId);
    revalidatePath("/dashboard/players");
    return { error: null, playerId: player.id };
  } catch (error) {
    return { error: toActionError(error, { action: "createPlayerAction", userId: authz.userId }) };
  }
}

export async function updatePlayerAction(
  playerId: string,
  input: UpdatePlayerInput,
): Promise<PlayerActionState> {
  const authz = await requirePlayersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updatePlayerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid player details." };
  }

  try {
    await playerService.updatePlayer(playerId, parsed.data, authz.userId);
    revalidatePath("/dashboard/players");
    revalidatePath(`/dashboard/players/${playerId}`);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "updatePlayerAction", userId: authz.userId }) };
  }
}

export async function deletePlayerAction(playerId: string): Promise<PlayerActionState> {
  const authz = await requirePlayersManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await playerService.deletePlayer(playerId, authz.userId);
    revalidatePath("/dashboard/players");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "deletePlayerAction", userId: authz.userId }) };
  }
}
