"use server";

import { revalidatePath } from "next/cache";

import {
  publicOpenPlayRegistrationSchema,
  type PublicOpenPlayRegistrationInput,
} from "@/features/open-play-capacity/schemas/public-open-play-registration.schema";
import { toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { createPublicOpenPlayRegistration } from "@/services/open-play/public-open-play-registration.service";

export interface PublicOpenPlayRegistrationActionState {
  error: string | null;
  status?: "disabled" | "date-blocked" | "not-yet-open" | "registered" | "waitlisted";
  opensAt?: Date;
  registrationId?: string;
  holdExpiresAt?: Date | null;
  waitlistEntryId?: string;
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// No session — the public, unauthenticated entry point (BUILD-SPEC.md
// §6). Thin wrapper only: validation + rate-limit + revalidation. The
// actual decision (including the two-gate switch check) lives in
// services/open-play/public-open-play-registration.service.ts, same
// split this codebase already uses for the public booking and public
// coaching paths.
export async function createPublicOpenPlayRegistrationAction(
  input: PublicOpenPlayRegistrationInput,
): Promise<PublicOpenPlayRegistrationActionState> {
  const parsed = publicOpenPlayRegistrationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid registration details." };
  }

  const rateLimit = checkRateLimit(
    `public-open-play-registration:${parsed.data.phone.replace(/\D/g, "")}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return { error: "Too many registration attempts — please wait a while and try again." };
  }

  try {
    const result = await createPublicOpenPlayRegistration(parsed.data);

    if (result.status === "disabled") {
      return { error: "Online registration isn't available for this night.", status: "disabled" };
    }

    if (result.status === "date-blocked") {
      return {
        error: "Online registration is closed for this date — contact us directly.",
        status: "date-blocked",
      };
    }

    if (result.status === "not-yet-open") {
      const opensAtLabel = result.opensAt.toLocaleDateString("en-PH", { month: "long", day: "numeric" });
      return {
        error: `Online registration for this date opens on ${opensAtLabel}. Please check back then.`,
        status: "not-yet-open",
        opensAt: result.opensAt,
      };
    }

    revalidatePath("/dashboard/admin/open-play-capacity");

    if (result.status === "registered") {
      return {
        error: null,
        status: "registered",
        registrationId: result.registrationId,
        holdExpiresAt: result.holdExpiresAt,
      };
    }
    return { error: null, status: "waitlisted", waitlistEntryId: result.waitlistEntryId };
  } catch (error) {
    return { error: toActionError(error, { action: "createPublicOpenPlayRegistrationAction" }) };
  }
}
