// Single resolver for the closed-registration message, consumed by every
// public surface (home card, register picker banner, register ?date=
// deep link, the createPublicOpenPlayRegistration action's date-blocked
// result) so there's exactly one place that decides "per-date override
// vs global default," not four independently-duplicated fallbacks.
// Trims and treats a whitespace-only per-date value the same as null —
// defense in depth on top of the write-side trim in
// OpenPlayCapacityService.setClosedMessageForDate, so a blank message
// can never render as an empty block regardless of how it got stored.
export function resolveOpenPlayClosedMessage(
  perDateMessage: string | null | undefined,
  globalDefault: string,
): string {
  const trimmed = perDateMessage?.trim();
  return trimmed ? trimmed : globalDefault;
}
