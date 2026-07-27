import { redirect } from "next/navigation";

// Nav-split (presentation/routing only): "Weeknight Open Play" needs a
// static href in lib/config.ts, but the actual destination is today's
// date, which changes daily. This route is the bridge — server-side
// (same TZ=Asia/Manila correctness this app enforces everywhere else,
// not the visitor's browser clock), computed the same way the old
// "Tonight's check-in" button on the list page did, then redirects
// straight to the existing [date] page. No new screen, no new
// day-type branching — that all still lives in [date]/page.tsx,
// unchanged.
function todayDateValue(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function OpenPlayCapacityTodayPage() {
  redirect(`/dashboard/admin/open-play-capacity/${todayDateValue()}`);
}
