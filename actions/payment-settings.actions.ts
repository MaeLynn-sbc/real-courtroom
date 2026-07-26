"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { settingsService } from "@/services/settings/settings.service";
import { PERMISSIONS } from "@/types/permissions";

export interface PaymentSettingsActionState {
  error: string | null;
}

function requireSystemAdmin() {
  return requirePermission(
    PERMISSIONS.SYSTEM_ADMIN,
    "You don't have permission to manage payment settings.",
  );
}

// Phase 8 Gate 2 (BUILD-SPEC.md §8, §15 "Owner-only payment settings —
// enforced server-side"). This is the ONLY way to flip the public
// prepayment switch — same SYSTEM_ADMIN tier every other owner-only
// setting in this codebase already uses (payment methods, CMS, module
// toggles), not a new, stricter check invented just for this one.
export async function setBookingRequirePrepaymentAction(
  value: boolean,
): Promise<PaymentSettingsActionState> {
  const authz = await requireSystemAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await settingsService.setBookingRequirePrepayment(value, authz.userId);
    revalidatePath("/book");
    revalidatePath("/dashboard/bookings");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "setBookingRequirePrepaymentAction", userId: authz.userId }),
    };
  }
}
