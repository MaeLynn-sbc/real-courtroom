import type { PlayerTabStatus } from "@/lib/generated/prisma/client";

// Incident (reported live, ~12:06 AM): a weeknight session running past
// midnight left real open tabs sitting on a calendar date nothing pointed
// at anymore — staff could only reach them by hand-editing the URL. This
// is the decision behind the banner that now surfaces that automatically.
// Deliberately no totalCents filter (unlike hasUnsettledTabs,
// app/dashboard/admin/open-play-capacity/[date]/page.tsx's own inline
// check for the close-session button) — a ₱0 OPEN tab still represents an
// unclosed session worth a look, even with nothing owed on it yet.
//
// Owner-reported follow-up (2026-08-08, ~12am): this used to also
// require today's own tab count to be exactly zero — meaning the warning
// silently stopped firing the moment even ONE new tab opened today,
// while yesterday's were still sitting unresolved. todayTabCount is no
// longer part of the decision at all — yesterday still open is reason
// enough on its own, regardless of what's happening today.
export function shouldShowCarryoverBanner(previousDayTabStatuses: PlayerTabStatus[]): boolean {
  return previousDayTabStatuses.includes("OPEN");
}
