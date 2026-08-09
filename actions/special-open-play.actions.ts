"use server";

import { revalidatePath } from "next/cache";

import {
  assignSpecialGroupToCourtSchema,
  checkInSpecialPlayerSchema,
  specialCheckInIdSchema,
  specialCourtActionSchema,
  type AssignSpecialGroupToCourtInput,
  type CheckInSpecialPlayerInput,
  type SpecialCheckInIdInput,
  type SpecialCourtActionInput,
} from "@/features/open-play-special/schemas/special-open-play.schema";
import { requireSystemAdmin } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { specialOpenPlayService } from "@/services/open-play-special/special-open-play.service";

export interface SpecialOpenPlayActionState {
  error: string | null;
}

// SYSTEM_ADMIN-gated, same as the page itself (owner/manager tier) —
// "visible only to me." No employee/shift requirement: nothing here
// creates a Sale, so there's no money attribution to resolve.
function requireSpecialOpenPlayAdmin() {
  return requireSystemAdmin("You don't have permission to manage Special Open Play.");
}

function revalidateSpecialOpenPlay(): void {
  revalidatePath("/dashboard/admin/openplayspecial");
}

export async function checkInSpecialPlayerAction(
  input: CheckInSpecialPlayerInput,
): Promise<SpecialOpenPlayActionState> {
  const authz = await requireSpecialOpenPlayAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = checkInSpecialPlayerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await specialOpenPlayService.checkIn(
      new Date(`${parsed.data.date}T00:00:00`),
      { playerName: parsed.data.playerName, phone: parsed.data.phone, skillLevel: parsed.data.skillLevel },
      authz.userId,
    );
    revalidateSpecialOpenPlay();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "checkInSpecialPlayerAction", userId: authz.userId }),
    };
  }
}

export async function assignSpecialGroupToCourtAction(
  input: AssignSpecialGroupToCourtInput,
): Promise<SpecialOpenPlayActionState> {
  const authz = await requireSpecialOpenPlayAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = assignSpecialGroupToCourtSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await specialOpenPlayService.assignGroupToCourt(parsed.data.checkInIds, parsed.data.courtLabel);
    revalidateSpecialOpenPlay();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "assignSpecialGroupToCourtAction", userId: authz.userId }),
    };
  }
}

export async function completeSpecialCourtGameAction(
  input: SpecialCourtActionInput,
): Promise<SpecialOpenPlayActionState> {
  const authz = await requireSpecialOpenPlayAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = specialCourtActionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await specialOpenPlayService.completeCourtGame(
      new Date(`${parsed.data.date}T00:00:00`),
      parsed.data.courtLabel,
    );
    revalidateSpecialOpenPlay();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "completeSpecialCourtGameAction", userId: authz.userId }),
    };
  }
}

export async function announceSpecialCourtAction(
  input: SpecialCourtActionInput,
): Promise<SpecialOpenPlayActionState> {
  const authz = await requireSpecialOpenPlayAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = specialCourtActionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await specialOpenPlayService.announceCourt(new Date(`${parsed.data.date}T00:00:00`), parsed.data.courtLabel);
    revalidateSpecialOpenPlay();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "announceSpecialCourtAction", userId: authz.userId }),
    };
  }
}

export async function announceSpecialCourtTimesUpAction(
  input: SpecialCourtActionInput,
): Promise<SpecialOpenPlayActionState> {
  const authz = await requireSpecialOpenPlayAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = specialCourtActionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await specialOpenPlayService.announceTimesUp(
      new Date(`${parsed.data.date}T00:00:00`),
      parsed.data.courtLabel,
    );
    revalidateSpecialOpenPlay();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "announceSpecialCourtTimesUpAction", userId: authz.userId }),
    };
  }
}

export async function checkOutSpecialPlayerAction(
  input: SpecialCheckInIdInput,
): Promise<SpecialOpenPlayActionState> {
  const authz = await requireSpecialOpenPlayAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = specialCheckInIdSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await specialOpenPlayService.checkOut(parsed.data.checkInId);
    revalidateSpecialOpenPlay();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "checkOutSpecialPlayerAction", userId: authz.userId }),
    };
  }
}
