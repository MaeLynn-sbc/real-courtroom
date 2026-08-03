"use server";

import { revalidatePath } from "next/cache";

import {
  createCategorySchema,
  createTournamentSchema,
  markWalkoverSchema,
  recordScoreSchema,
  registerTeamSchema,
  scheduleMatchSchema,
  updateCategoryMaxTeamsSchema,
  updateTournamentStatusSchema,
  type CreateCategoryInput,
  type CreateTournamentInput,
  type MarkWalkoverInput,
  type RecordScoreInput,
  type RegisterTeamInput,
  type ScheduleMatchInput,
  type UpdateCategoryMaxTeamsInput,
  type UpdateTournamentStatusInput,
} from "@/features/tournaments/schemas/tournament.schema";
import { requireEmployeeWithOpenShift, requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { matchService } from "@/services/tournaments/match.service";
import { tournamentService } from "@/services/tournaments/tournament.service";
import { PERMISSIONS } from "@/types/permissions";

export interface TournamentActionState {
  error: string | null;
}

export interface CreateTournamentActionState extends TournamentActionState {
  tournamentId?: string;
}

export interface CreateCategoryActionState extends TournamentActionState {
  categoryId?: string;
}

function requireTournamentsManage() {
  return requirePermission(
    PERMISSIONS.TOURNAMENTS_MANAGE,
    "You don't have permission to manage tournaments.",
  );
}

function revalidateTournament(tournamentId: string): void {
  revalidatePath("/dashboard/tournaments");
  revalidatePath(`/dashboard/tournaments/${tournamentId}`);
}

function revalidateCategory(tournamentId: string, categoryId: string): void {
  revalidateTournament(tournamentId);
  revalidatePath(`/dashboard/tournaments/${tournamentId}/categories/${categoryId}`);
}

export async function createTournamentAction(
  input: CreateTournamentInput,
): Promise<CreateTournamentActionState> {
  const authz = await requireTournamentsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createTournamentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid tournament details." };
  }

  try {
    const tournament = await tournamentService.createTournament(parsed.data, authz.userId);
    revalidatePath("/dashboard/tournaments");
    return { error: null, tournamentId: tournament.id };
  } catch (error) {
    return {
      error: toActionError(error, { action: "createTournamentAction", userId: authz.userId }),
    };
  }
}

export async function updateTournamentAction(
  tournamentId: string,
  input: CreateTournamentInput,
): Promise<TournamentActionState> {
  const authz = await requireTournamentsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createTournamentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid tournament details." };
  }

  try {
    await tournamentService.updateTournament(tournamentId, parsed.data, authz.userId);
    revalidateTournament(tournamentId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "updateTournamentAction", userId: authz.userId }),
    };
  }
}

export async function updateTournamentStatusAction(
  tournamentId: string,
  input: UpdateTournamentStatusInput,
): Promise<TournamentActionState> {
  const authz = await requireTournamentsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateTournamentStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid status." };
  }

  try {
    await tournamentService.updateTournamentStatus(tournamentId, parsed.data.status, authz.userId);
    revalidateTournament(tournamentId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "updateTournamentStatusAction", userId: authz.userId }),
    };
  }
}

export async function createCategoryAction(
  tournamentId: string,
  input: CreateCategoryInput,
): Promise<CreateCategoryActionState> {
  const authz = await requireTournamentsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid category details." };
  }

  try {
    const category = await tournamentService.createCategory(
      tournamentId,
      parsed.data,
      authz.userId,
    );
    revalidateTournament(tournamentId);
    return { error: null, categoryId: category.id };
  } catch (error) {
    return {
      error: toActionError(error, { action: "createCategoryAction", userId: authz.userId }),
    };
  }
}

export async function updateCategoryMaxTeamsAction(
  tournamentId: string,
  categoryId: string,
  input: UpdateCategoryMaxTeamsInput,
): Promise<TournamentActionState> {
  const authz = await requireTournamentsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateCategoryMaxTeamsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid max teams value." };
  }

  try {
    await tournamentService.updateCategoryMaxTeams(
      categoryId,
      parsed.data.maxTeams ?? null,
      authz.userId,
    );
    revalidateCategory(tournamentId, categoryId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "updateCategoryMaxTeamsAction", userId: authz.userId }),
    };
  }
}

export async function registerTeamAction(
  tournamentId: string,
  categoryId: string,
  input: RegisterTeamInput,
): Promise<TournamentActionState> {
  const authz = await requireEmployeeWithOpenShift(
    PERMISSIONS.TOURNAMENTS_MANAGE,
    "You don't have permission to manage tournaments.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = registerTeamSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid registration details." };
  }

  try {
    await tournamentService.registerTeam(categoryId, parsed.data, authz.userId, {
      employeeId: authz.employeeId,
      shiftId: authz.shiftId,
      paymentMethodId: parsed.data.paymentMethodId,
    });
    revalidateCategory(tournamentId, categoryId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "registerTeamAction", userId: authz.userId }) };
  }
}

export async function cancelRegistrationAction(
  tournamentId: string,
  categoryId: string,
  registrationId: string,
): Promise<TournamentActionState> {
  const authz = await requireTournamentsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await tournamentService.cancelRegistration(registrationId, authz.userId);
    revalidateCategory(tournamentId, categoryId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "cancelRegistrationAction", userId: authz.userId }),
    };
  }
}

export async function generateBracketAction(
  tournamentId: string,
  categoryId: string,
): Promise<TournamentActionState> {
  const authz = await requireTournamentsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await tournamentService.generateBracket(categoryId, authz.userId);
    revalidateCategory(tournamentId, categoryId);
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "generateBracketAction", userId: authz.userId }),
    };
  }
}

export async function scheduleMatchAction(
  tournamentId: string,
  categoryId: string,
  matchId: string,
  input: ScheduleMatchInput,
): Promise<TournamentActionState> {
  const authz = await requireTournamentsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = scheduleMatchSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid schedule details." };
  }

  try {
    await matchService.scheduleMatch(matchId, parsed.data, authz.userId);
    revalidateCategory(tournamentId, categoryId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "scheduleMatchAction", userId: authz.userId }) };
  }
}

export async function recordScoreAction(
  tournamentId: string,
  categoryId: string,
  matchId: string,
  input: RecordScoreInput,
): Promise<TournamentActionState> {
  const authz = await requireTournamentsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = recordScoreSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid score." };
  }

  try {
    await matchService.recordScore(matchId, parsed.data, authz.userId);
    revalidateCategory(tournamentId, categoryId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "recordScoreAction", userId: authz.userId }) };
  }
}

export async function completeMatchAction(
  tournamentId: string,
  categoryId: string,
  matchId: string,
): Promise<TournamentActionState> {
  const authz = await requireTournamentsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await matchService.completeMatch(matchId, authz.userId);
    revalidateCategory(tournamentId, categoryId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "completeMatchAction", userId: authz.userId }) };
  }
}

export async function markWalkoverAction(
  tournamentId: string,
  categoryId: string,
  matchId: string,
  input: MarkWalkoverInput,
): Promise<TournamentActionState> {
  const authz = await requireTournamentsManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = markWalkoverSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Select the winning team." };
  }

  try {
    await matchService.markWalkover(matchId, parsed.data.winnerTeamId, authz.userId);
    revalidateCategory(tournamentId, categoryId);
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "markWalkoverAction", userId: authz.userId }) };
  }
}
