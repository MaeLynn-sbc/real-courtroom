import type { PublicOpenPlayRegistrationInput } from "@/features/open-play-capacity/schemas/public-open-play-registration.schema";
import { openPlayCapacityService } from "@/services/open-play/open-play-capacity.service";
import { openPlayRegistrationService } from "@/services/open-play/open-play-registration.service";
import { settingsService } from "@/services/settings/settings.service";

export type CreatePublicOpenPlayRegistrationResult =
  | { status: "disabled" }
  | { status: "not-yet-open"; opensAt: Date }
  | { status: "registered"; registrationId: string; holdExpiresAt: Date | null }
  | { status: "waitlisted"; waitlistEntryId: string };

// Extracted from actions/public-open-play-registration.actions.ts, same
// reason as services/booking/public-booking.service.ts's own extraction
// comment: next/cache's revalidatePath throws outside a real Next.js
// request context, so the actual decision logic (including the two-gate
// switch check) has to live somewhere a plain integration test can call
// directly. The thin action wrapper does nothing but rate-limit, call
// this, and revalidate.
//
// Two independent gates, both required (BUILD-SPEC.md §6) — checked
// here, not inside openPlayRegistrationService.submitOnlineRegistration,
// which assumes the caller already decided registration is allowed:
//   1. settingsService.getOpenPlayOnlineRegistrationEnabled() — the
//      feature-wide switch. Off by default; reads fresh on every call,
//      never cached, exactly like Phase 8's own booking-prepayment
//      switch check.
//   2. OpenPlayCapacityDefault.onlineRegistrationEnabled for the
//      session's own day of week — the per-day narrowing on top.
// Either gate closed returns "disabled", not an error thrown — there is
// no pre-existing "old flow" to fall back to the way Booking's public
// action falls back to instant-confirm when its switch is off; before
// this feature existed there was no online registration path at all.
export async function createPublicOpenPlayRegistration(
  input: PublicOpenPlayRegistrationInput,
): Promise<CreatePublicOpenPlayRegistrationResult> {
  const featureEnabled = await settingsService.getOpenPlayOnlineRegistrationEnabled();
  if (!featureEnabled) {
    return { status: "disabled" };
  }

  const date = new Date(`${input.date}T00:00:00`);
  const session = await openPlayCapacityService.getOrCreateSessionForDate(date);

  const defaults = await openPlayCapacityService.getCapacityDefaults();
  const dayEnabled = defaults.find((row) => row.dayOfWeek === date.getDay())?.onlineRegistrationEnabled ?? false;
  if (!dayEnabled) {
    return { status: "disabled" };
  }

  // Gate 2 review follow-up: a third, distinct check on top of the two
  // on/off gates above — a rolling window, not a boolean. Compared as
  // whole calendar days (both sides pinned to local midnight) so "N days
  // before" means N calendar days, not a fractional 24-hour count that
  // would open registration at a different hour every day. Owner-
  // editable via openPlaySettingsSchema.onlineRegistrationLeadTimeDays,
  // not hardcoded.
  const { onlineRegistrationLeadTimeDays } = await settingsService.getOpenPlaySettings();
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const daysUntilSession = Math.round((date.getTime() - todayMidnight.getTime()) / (24 * 60 * 60 * 1000));
  if (daysUntilSession > onlineRegistrationLeadTimeDays) {
    const opensAt = new Date(date.getTime() - onlineRegistrationLeadTimeDays * 24 * 60 * 60 * 1000);
    return { status: "not-yet-open", opensAt };
  }

  const result = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
    playerName: input.playerName,
    phone: input.phone,
    skillLevel: input.skillLevel,
  });

  if (result.kind === "registered") {
    return {
      status: "registered",
      registrationId: result.registration.id,
      holdExpiresAt: result.registration.holdExpiresAt,
    };
  }
  return { status: "waitlisted", waitlistEntryId: result.entry.id };
}
