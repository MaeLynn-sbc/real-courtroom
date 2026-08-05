import type { PlayerTabStatus } from "@/lib/generated/prisma/client";

// Incident (reported live, ~12:06 AM): a weeknight session running past
// midnight left real open tabs sitting on a calendar date nothing pointed
// at anymore — staff could only reach them by hand-editing the URL. This
// is the decision behind the banner that now surfaces that automatically:
// shown when today has zero tab rows at all AND the previous day still has
// an OPEN one. Deliberately no totalCents filter (unlike hasUnsettledTabs,
// app/dashboard/admin/open-play-capacity/[date]/page.tsx's own inline
// check for the close-session button) — a ₱0 OPEN tab still represents an
// unclosed session worth a look, even with nothing owed on it yet.
export function shouldShowCarryoverBanner(
  todayTabCount: number,
  previousDayTabStatuses: PlayerTabStatus[],
): boolean {
  if (todayTabCount > 0) {
    return false;
  }
  return previousDayTabStatuses.includes("OPEN");
}
