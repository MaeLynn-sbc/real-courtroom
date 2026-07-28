"use server";

import { revalidatePath } from "next/cache";

import { openPlaySettingsSchema, type OpenPlaySettings } from "@/features/cms/schemas/cms.schema";
import {
  checkInInputSchema,
  registerAndCheckInInputSchema,
  type CheckInInput,
  type RegisterAndCheckInInput,
} from "@/features/open-play-capacity/schemas/open-play-checkin.schema";
import { requireEmployeeWithOpenShift, requirePermission, requireSystemAdmin } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { openPlayCheckinService } from "@/services/open-play/open-play-checkin.service";
import { settingsService } from "@/services/settings/settings.service";
import { PERMISSIONS } from "@/types/permissions";

export interface OpenPlayCheckinActionState {
  error: string | null;
  // Set true only by registerAndCheckInAction, only when the walk-in
  // landed on the waiting roster instead of a real seat (owner decision,
  // Fri/Sat waitlist rework) — lets the form show "added to the waiting
  // roster" instead of "checked in," since no check-in was attempted.
  waitlisted?: boolean;
}

function requireOpenPlayManage() {
  return requirePermission(PERMISSIONS.OPEN_PLAY_MANAGE, "You don't have permission to manage open play.");
}

function revalidateCheckIn(): void {
  revalidatePath("/dashboard/admin/open-play-capacity");
}

export async function checkInAction(input: CheckInInput): Promise<OpenPlayCheckinActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = checkInInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayCheckinService.checkIn(parsed.data.registrationId, authz.userId);
    revalidateCheckIn();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "checkInAction", userId: authz.userId }) };
  }
}

export async function undoCheckInAction(input: CheckInInput): Promise<OpenPlayCheckinActionState> {
  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = checkInInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await openPlayCheckinService.undoCheckIn(parsed.data.registrationId, authz.userId);
    revalidateCheckIn();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "undoCheckInAction", userId: authz.userId }) };
  }
}

// The "one-tap walk-in" action (BUILD-SPEC.md §6) — registers and checks
// in together. Exactly one of sessionId/date must be provided by the
// caller (Fri/Sat session detail page vs. weeknight check-in screen).
//
// Gate 2 review follow-up: the Fri/Sat branch also collects the ₱150
// registration fee (a real Sale — same "employee + open shift" standard
// as every other money-moving action), so its authorization differs
// from the weeknight branch, which creates no Sale at registration
// time. Branched at the top rather than always requiring an open
// shift, so weeknight walk-in registration (no money changes hands
// until tab settlement, later) keeps its existing, narrower
// requirement — permission only, unchanged.
export async function registerAndCheckInAction(
  input: RegisterAndCheckInInput,
): Promise<OpenPlayCheckinActionState> {
  const parsed = registerAndCheckInInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid registration." };
  }
  if (!parsed.data.sessionId && !parsed.data.date) {
    return { error: "Missing session or date." };
  }

  const base = {
    playerName: parsed.data.playerName,
    phone: parsed.data.phone,
    skillLevel: parsed.data.skillLevel,
    playerId: parsed.data.playerId,
    partyId: parsed.data.partyId,
  };

  if (parsed.data.sessionId) {
    const authz = await requireEmployeeWithOpenShift(
      PERMISSIONS.OPEN_PLAY_MANAGE,
      "You don't have permission to manage open play.",
    );
    if (!authz.ok) {
      return { error: authz.error };
    }
    if (!parsed.data.method || !parsed.data.paymentMethodId) {
      return { error: "Select a payment method." };
    }
    if (parsed.data.method === "GCASH" && !parsed.data.gcashReference?.trim()) {
      return { error: "A GCash reference number is required." };
    }

    try {
      const result = await openPlayCheckinService.registerAndCheckIn(
        {
          sessionId: parsed.data.sessionId,
          saleContext: {
            method: parsed.data.method,
            gcashReference: parsed.data.gcashReference ?? null,
            paymentMethodId: parsed.data.paymentMethodId,
            employeeId: authz.employeeId,
            shiftId: authz.shiftId,
          },
        },
        base,
        authz.userId,
      );
      revalidateCheckIn();
      return { error: null, waitlisted: result.registration.waitlistPos !== null };
    } catch (error) {
      return { error: toActionError(error, { action: "registerAndCheckInAction", userId: authz.userId }) };
    }
  }

  const authz = await requireOpenPlayManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await openPlayCheckinService.registerAndCheckIn(
      { date: new Date(`${parsed.data.date}T00:00:00`) },
      base,
      authz.userId,
    );
    revalidateCheckIn();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "registerAndCheckInAction", userId: authz.userId }) };
  }
}

// Owner-only, matching Court Hours/Open Play Capacity — business-policy
// configuration, not day-to-day operations.
export async function setOpenPlaySettingsAction(input: OpenPlaySettings): Promise<OpenPlayCheckinActionState> {
  const authz = await requireSystemAdmin("You don't have permission to manage open play settings.");
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = openPlaySettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid settings." };
  }

  try {
    await settingsService.setOpenPlaySettings(parsed.data, authz.userId);
    revalidateCheckIn();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setOpenPlaySettingsAction", userId: authz.userId }) };
  }
}
