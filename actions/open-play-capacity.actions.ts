"use server";

import { revalidatePath } from "next/cache";

import {
  capacityDefaultInputSchema,
  closedMessageForDateInputSchema,
  onlineRegistrationBlockedForDateInputSchema,
  onlineRegistrationEnabledInputSchema,
  sessionCapacityOverrideInputSchema,
  type CapacityDefaultInput,
  type ClosedMessageForDateInput,
  type OnlineRegistrationBlockedForDateInput,
  type OnlineRegistrationEnabledInput,
  type SessionCapacityOverrideInput,
} from "@/features/open-play-capacity/schemas/open-play-capacity.schema";
import { requireSystemAdmin } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { openPlayCapacityService } from "@/services/open-play/open-play-capacity.service";

export interface OpenPlayCapacityActionState {
  error: string | null;
}

// Business-policy configuration (same category as Court Hours), not
// day-to-day open-play operations — gated the same way Court Hours is,
// not by the OPEN_PLAY_MANAGE permission the (separate) rotation feature uses.
function requireOpenPlayCapacityAdmin() {
  return requireSystemAdmin("You don't have permission to manage open play capacity.");
}

function revalidateOpenPlayCapacity(): void {
  revalidatePath("/dashboard/admin/open-play-capacity");
}

export async function setCapacityDefaultAction(
  input: CapacityDefaultInput,
): Promise<OpenPlayCapacityActionState> {
  const authz = await requireOpenPlayCapacityAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = capacityDefaultInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid capacity." };
  }

  try {
    await openPlayCapacityService.setCapacityDefault(
      parsed.data.dayOfWeek,
      parsed.data.capacity,
      authz.userId,
    );
    revalidateOpenPlayCapacity();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "setCapacityDefaultAction", userId: authz.userId }),
    };
  }
}

export async function setOnlineRegistrationEnabledAction(
  input: OnlineRegistrationEnabledInput,
): Promise<OpenPlayCapacityActionState> {
  const authz = await requireOpenPlayCapacityAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = onlineRegistrationEnabledInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(
      parsed.data.dayOfWeek,
      parsed.data.enabled,
      authz.userId,
    );
    revalidateOpenPlayCapacity();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "setOnlineRegistrationEnabledAction",
        userId: authz.userId,
      }),
    };
  }
}

export async function setOnlineRegistrationBlockedForDateAction(
  input: OnlineRegistrationBlockedForDateInput,
): Promise<OpenPlayCapacityActionState> {
  const authz = await requireOpenPlayCapacityAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = onlineRegistrationBlockedForDateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const date = new Date(`${parsed.data.date}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return { error: "Enter a valid date." };
  }

  try {
    await openPlayCapacityService.setOnlineRegistrationBlockedForDate(
      date,
      parsed.data.blocked,
      authz.userId,
    );
    revalidateOpenPlayCapacity();
    revalidatePath("/open-play/register");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "setOnlineRegistrationBlockedForDateAction",
        userId: authz.userId,
      }),
    };
  }
}

// Editable independent of the block toggle above, on purpose — an owner
// can write the message ahead of flipping the switch, or after. Not
// gated on `blocked` in this action or in the component that calls it.
export async function setClosedMessageForDateAction(
  input: ClosedMessageForDateInput,
): Promise<OpenPlayCapacityActionState> {
  const authz = await requireOpenPlayCapacityAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = closedMessageForDateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const date = new Date(`${parsed.data.date}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return { error: "Enter a valid date." };
  }

  try {
    await openPlayCapacityService.setClosedMessageForDate(date, parsed.data.message, authz.userId);
    revalidateOpenPlayCapacity();
    revalidatePath("/open-play/register");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "setClosedMessageForDateAction",
        userId: authz.userId,
      }),
    };
  }
}

export async function setSessionCapacityOverrideAction(
  input: SessionCapacityOverrideInput,
): Promise<OpenPlayCapacityActionState> {
  const authz = await requireOpenPlayCapacityAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = sessionCapacityOverrideInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid capacity." };
  }

  const date = new Date(`${parsed.data.date}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return { error: "Enter a valid date." };
  }

  try {
    await openPlayCapacityService.setSessionCapacityOverride(
      date,
      parsed.data.capacity,
      authz.userId,
    );
    revalidateOpenPlayCapacity();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "setSessionCapacityOverrideAction",
        userId: authz.userId,
      }),
    };
  }
}
