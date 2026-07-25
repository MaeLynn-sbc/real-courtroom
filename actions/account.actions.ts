"use server";

import { signOut } from "@/auth";
import {
  changePasswordSchema,
  type ChangePasswordInput,
} from "@/features/auth/schemas/change-password.schema";
import { requireSession } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { accountService } from "@/services/auth/account.service";

export interface ChangePasswordActionState {
  error: string | null;
}

// Deliberately requireSession, not requirePermission — this is the one
// action a must-change-password account is allowed to reach (see
// lib/action-auth.ts's requirePermission comment and lib/rbac.ts's
// requiresPasswordChangeRedirect). No specific permission is the right
// gate for "change your own password"; being signed in as yourself is.
export async function changePasswordAction(
  input: ChangePasswordInput,
): Promise<ChangePasswordActionState> {
  const authz = await requireSession();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid password details." };
  }

  try {
    const result = await accountService.changePassword(authz.userId, parsed.data);
    if (!result.ok) {
      return { error: result.error };
    }
  } catch (error) {
    return { error: toActionError(error, { action: "changePasswordAction", userId: authz.userId }) };
  }

  // Forces a fresh sign-in with the new password — the simplest correct
  // way to invalidate THIS session too, and it sidesteps needing to
  // rewrite the current request's JWT cookie mid-response. Other active
  // sessions are separately invalidated by the passwordChangedAt bump
  // this just wrote (see auth.ts's jwt() callback) the next time each of
  // them hits any server-side auth() call.
  await signOut({ redirectTo: "/login?passwordChanged=1" });
  return { error: null };
}
