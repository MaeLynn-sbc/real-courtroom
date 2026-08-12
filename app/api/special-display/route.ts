import { NextResponse } from "next/server";

import { computeBusinessDate } from "@/lib/business-date";
import { specialDisplayService } from "@/services/display/special-display.service";
import { settingsService } from "@/services/settings/settings.service";

// Owner request (2026-08-09): Special Open Play's own display feed —
// deliberately separate from /api/display and /api/tournament-display,
// zero shared code. Public, unauthenticated (a TV/kiosk screen can't
// stay signed in) — the shape is already scrubbed of anything sensitive
// (short names only, no phone/skill/payment).
export async function GET() {
  // Owner-directed consolidation (2026-08-12): rollover-hour aware, not
  // literal calendar midnight.
  const courtHours = await settingsService.getCourtHours();
  const today = computeBusinessDate(new Date(), courtHours.businessDateRolloverHour);
  const data = await specialDisplayService.getDisplayData(today);

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
