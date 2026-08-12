import { redirect } from "next/navigation";

import { computeBusinessDate } from "@/lib/business-date";
import { playerTabService } from "@/services/open-play/player-tab.service";
import { settingsService } from "@/services/settings/settings.service";

// Nav-split (presentation/routing only): "Regular Open Play" needs a
// static href in lib/config.ts, but the actual destination is today's
// date, which changes daily. This route is the bridge — server-side
// (same TZ=Asia/Manila correctness this app enforces everywhere else,
// not the visitor's browser clock), computed the same way the old
// "Tonight's check-in" button on the list page did, then redirects
// straight to the existing [date] page. No new screen, no new
// day-type branching — that all still lives in [date]/page.tsx,
// unchanged.
function toDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default async function OpenPlayCapacityTodayPage() {
  // Owner-directed consolidation (2026-08-12): "today" is now the same
  // rollover-hour-aware computeBusinessDate every other correct part
  // of the app uses, not literal calendar midnight — narrows the
  // window the still-open-tabs check below has to protect against,
  // though it stays as its own check (see its own comment) since a
  // tab can still be genuinely open well past the rollover hour too.
  const courtHours = await settingsService.getCourtHours();
  const today = computeBusinessDate(new Date(), courtHours.businessDateRolloverHour);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Owner-reported incident (2026-08-08, ~12am): this link is the
  // primary way staff reach tonight's weeknight rotation, every single
  // night — always resolving to CALENDAR today silently stranded a
  // session still running past midnight (real open tabs, nobody
  // pointing at them but a hand-typed URL). Checked independently of
  // today's own tab count — OpenTabsCarryoverBanner's otherwise-similar
  // check (lib/open-play-carryover.ts) only fires when today has ZERO
  // tabs, which stops protecting the moment even one new tab opens
  // today while yesterday's are still sitting open.
  const yesterdayTabs = await playerTabService.listTabsForDate(yesterday);
  const yesterdayStillOpen = yesterdayTabs.some((tab) => tab.status === "OPEN");

  redirect(`/dashboard/admin/open-play-capacity/${toDateValue(yesterdayStillOpen ? yesterday : today)}`);
}
